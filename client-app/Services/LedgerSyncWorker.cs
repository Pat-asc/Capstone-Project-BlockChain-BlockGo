using BlockGo.Models;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Npgsql;

namespace BlockGo.Services
{
    public class LedgerSyncWorker : BackgroundService
    {
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly IConfiguration _configuration;
        private readonly ILogger<LedgerSyncWorker> _logger;
        private readonly string _connectionString;
        private readonly TimeSpan _interval;
        private readonly string _syncInvoker;

        public LedgerSyncWorker(
            IServiceScopeFactory scopeFactory,
            IConfiguration configuration,
            ILogger<LedgerSyncWorker> logger)
        {
            _scopeFactory = scopeFactory;
            _configuration = configuration;
            _logger = logger;
            _connectionString = configuration.GetConnectionString("MasterConnection")
                ?? configuration.GetConnectionString("PostgresConnection")
                ?? throw new InvalidOperationException("Postgres connection string is not configured.");

            var seconds = int.TryParse(Environment.GetEnvironmentVariable("LEDGER_SYNC_INTERVAL_SECONDS"), out var parsed)
                ? parsed
                : 60;
            _interval = TimeSpan.FromSeconds(Math.Max(15, seconds));
            _syncInvoker = Environment.GetEnvironmentVariable("LEDGER_SYNC_INVOKER")
                ?? configuration["LedgerSync:Invoker"]
                ?? "registrar@plv.edu.ph";
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            if (string.Equals(Environment.GetEnvironmentVariable("LEDGER_SYNC_DISABLED"), "true", StringComparison.OrdinalIgnoreCase))
            {
                _logger.LogWarning("Ledger sync worker disabled by LEDGER_SYNC_DISABLED=true.");
                return;
            }

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await SyncPendingFinalizedRecordsAsync(stoppingToken);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Ledger sync worker cycle failed.");
                }

                await Task.Delay(_interval, stoppingToken);
            }
        }

        private async Task SyncPendingFinalizedRecordsAsync(CancellationToken cancellationToken)
        {
            var records = new List<AcademicRecord>();

            await using (var conn = new NpgsqlConnection(_connectionString))
            {
                await conn.OpenAsync(cancellationToken);
                await EnsureLedgerSyncColumnsAsync(conn, cancellationToken);

                await using var cmd = new NpgsqlCommand(@"
                    SELECT id, student_hash, student_no, student_name, section, course, subject_code, grade,
                           semester, school_year, faculty_id, date, ipfs_cid, status, note
                    FROM pending_grade_records
                    WHERE status = 'Finalized'
                      AND COALESCE(note, '') LIKE '%LedgerSyncPending%'
                    ORDER BY date ASC
                    LIMIT 25;", conn);

                await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken))
                {
                    records.Add(new AcademicRecord
                    {
                        Id = reader.IsDBNull(0) ? "" : reader.GetString(0),
                        StudentHash = reader.IsDBNull(1) ? "" : reader.GetString(1),
                        StudentNo = reader.IsDBNull(2) ? "" : reader.GetString(2),
                        StudentName = reader.IsDBNull(3) ? "" : reader.GetString(3),
                        Section = reader.IsDBNull(4) ? "" : reader.GetString(4),
                        Course = reader.IsDBNull(5) ? "" : reader.GetString(5),
                        SubjectCode = reader.IsDBNull(6) ? "" : reader.GetString(6),
                        Grade = reader.IsDBNull(7) ? "" : reader.GetString(7),
                        Semester = reader.IsDBNull(8) ? "" : reader.GetString(8),
                        SchoolYear = reader.IsDBNull(9) ? "" : reader.GetString(9),
                        FacultyId = reader.IsDBNull(10) ? "" : reader.GetString(10),
                        Date = reader.IsDBNull(11) ? "" : reader.GetString(11),
                        IpfsCid = reader.IsDBNull(12) ? "" : reader.GetString(12),
                        Status = "Finalized",
                        Note = reader.IsDBNull(14) ? "" : reader.GetString(14),
                        University = "PLV",
                        Version = 1
                    });
                }
            }

            if (records.Count == 0) return;

            _logger.LogInformation("Ledger sync worker found {Count} finalized records pending Fabric sync.", records.Count);

            foreach (var record in records)
            {
                if (cancellationToken.IsCancellationRequested) break;
                await SyncOneRecordAsync(record, cancellationToken);
            }
        }

        private async Task SyncOneRecordAsync(AcademicRecord record, CancellationToken cancellationToken)
        {
            try
            {
                using var scope = _scopeFactory.CreateScope();
                var blockchainService = scope.ServiceProvider.GetRequiredService<IBlockchainService>();

                var facultyInvoker = string.IsNullOrWhiteSpace(record.FacultyId) ? _syncInvoker : record.FacultyId;
                var existsOnLedger = false;

                try
                {
                    var existing = await blockchainService.GetGradeAsync(record.Id, facultyInvoker);
                    existsOnLedger = !string.IsNullOrWhiteSpace(existing)
                        && !existing.Contains("error", StringComparison.OrdinalIgnoreCase)
                        && !existing.Contains("not found", StringComparison.OrdinalIgnoreCase);
                }
                catch
                {
                    existsOnLedger = false;
                }

                if (existsOnLedger) await blockchainService.UpdateGradeAsync(record, facultyInvoker);
                else await blockchainService.SubmitGradeAsync(record, facultyInvoker);

                await blockchainService.ApproveGradeAsync(record.Id, _syncInvoker);
                await blockchainService.FinalizeGradeAsync(record.Id, _syncInvoker);

                await using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync(cancellationToken);
                await using var delete = new NpgsqlCommand("DELETE FROM pending_grade_records WHERE id = @id", conn);
                delete.Parameters.AddWithValue("id", record.Id);
                await delete.ExecuteNonQueryAsync(cancellationToken);

                _logger.LogInformation("Ledger sync completed for finalized record {RecordId}.", record.Id);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Ledger sync still pending for finalized record {RecordId}.", record.Id);

                await using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync(cancellationToken);
                await using var update = new NpgsqlCommand(@"
                    UPDATE pending_grade_records
                    SET note = @note
                    WHERE id = @id;", conn);
                update.Parameters.AddWithValue("id", record.Id);
                update.Parameters.AddWithValue("note", BuildPendingNote(ex.Message));
                await update.ExecuteNonQueryAsync(cancellationToken);
            }
        }

        private static async Task EnsureLedgerSyncColumnsAsync(NpgsqlConnection conn, CancellationToken cancellationToken)
        {
            await using var cmd = new NpgsqlCommand(@"
                CREATE TABLE IF NOT EXISTS pending_grade_records (
                    id VARCHAR(255) PRIMARY KEY,
                    student_hash VARCHAR(255),
                    student_no VARCHAR(255),
                    student_name VARCHAR(255),
                    section VARCHAR(100),
                    course VARCHAR(255),
                    subject_code VARCHAR(100),
                    grade TEXT,
                    semester VARCHAR(50),
                    school_year VARCHAR(50),
                    faculty_id VARCHAR(255),
                    date VARCHAR(50),
                    ipfs_cid VARCHAR(255),
                    status VARCHAR(50),
                    note TEXT
                );

                ALTER TABLE pending_grade_records ALTER COLUMN grade TYPE TEXT;

                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'pending_grade_records' AND column_name = 'note'
                    ) THEN
                        ALTER TABLE pending_grade_records ADD COLUMN note TEXT;
                    END IF;
                END $$;", conn);
            await cmd.ExecuteNonQueryAsync(cancellationToken);
        }

        private static string BuildPendingNote(string error)
        {
            var trimmed = string.IsNullOrWhiteSpace(error) ? "Fabric ledger unavailable" : error;
            if (trimmed.Length > 500) trimmed = trimmed[..500];
            return $"LedgerSyncPending: {DateTime.UtcNow:o}: {trimmed}";
        }
    }
}
