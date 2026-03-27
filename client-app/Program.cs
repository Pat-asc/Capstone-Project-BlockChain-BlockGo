using Serilog;
using BlockGo.Services;
using Microsoft.EntityFrameworkCore;
using System.Threading.RateLimiting;
using Client_app.Services;
using Client_app.Middleware;
using Client_app.Models;
using For_Testing_Only_Capstone.Models;

AppContext.SetSwitch("Npgsql.EnableLegacyTimestampBehavior", true);

Log.Logger = new LoggerConfiguration()
    .MinimumLevel.Information()
    .WriteTo.Console()
    .WriteTo.File(
        "logs/app-.txt",
        rollingInterval: RollingInterval.Day,
        outputTemplate: "{Timestamp:yyyy-MM-dd HH:mm:ss.fff zzz} [{Level:u3}] {Message:lj}{NewLine}{Exception}")
    .Enrich.FromLogContext()
    .CreateLogger();

try
{
    Log.Information("Application starting up...");
    
    var builder = WebApplication.CreateBuilder(args);
    builder.WebHost.UseUrls("http://*:5000");
    
    builder.Host.UseSerilog();

    builder.Services.AddCors(options =>
    {
        options.AddPolicy("AllowFrontend", policy =>
        {
            policy.AllowAnyOrigin()
                  .AllowAnyMethod()
                  .AllowAnyHeader();
        });
    });

    builder.Services.AddControllers();
    builder.Services.AddMemoryCache();
    builder.Services.AddEndpointsApiExplorer();
    builder.Services.AddSwaggerGen();

    builder.Services.AddExceptionHandler<GlobalExceptionHandler>();
    builder.Services.AddProblemDetails();

    var rateLimitOptions = builder.Configuration.GetSection("RateLimiting");
    var permitLimit = int.Parse(rateLimitOptions["PermitLimit"] ?? "10");
    var windowSeconds = int.Parse(rateLimitOptions["WindowSeconds"] ?? "60");

    builder.Services.AddRateLimiter(options =>
    {
        options.AddPolicy("fixed", httpContext =>
            RateLimitPartition.GetFixedWindowLimiter(
                partitionKey: httpContext.User.Identity?.Name ?? httpContext.Connection.RemoteIpAddress?.ToString() ?? "anonymous",
                factory: partition => new FixedWindowRateLimiterOptions
                {
                    AutoReplenishment = true,
                    PermitLimit = permitLimit,
                    Window = TimeSpan.FromSeconds(windowSeconds)
                }));
        
        options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
        options.OnRejected = async (context, token) =>
        {
            context.HttpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;
            await context.HttpContext.Response.WriteAsJsonAsync(
                new { status = "Error", message = "Too many requests. Please try again later." }, 
                token);
        };
    });

    builder.Services.AddHttpClient<IBlockchainService, BlockchainService>();
    builder.Services.AddScoped<IFabricCaAuthService, FabricCaAuthService>();
    builder.Services.AddScoped<IEmailService, EmailService>();

    builder.Services.AddHttpClient("FabricCAClient")
    .ConfigurePrimaryHttpMessageHandler(() =>
    {
        var handler = new HttpClientHandler();
        bool allowInsecure = builder.Environment.IsDevelopment() || 
                             builder.Configuration.GetValue<bool>("Security:AllowInsecureTls");

        if (allowInsecure)
        {
            Log.Warning("nternal Fabric CA connection: SSL validation BYPASSED (Development or Config Override)");
            handler.ServerCertificateCustomValidationCallback = (message, cert, chain, errors) => true;
        }
        else
        {
            Log.Information("nternal Fabric CA connection: Strict SSL validation ENABLED (Production Mode)");
            handler.ServerCertificateCustomValidationCallback = null; 
        }

        handler.SslProtocols = System.Security.Authentication.SslProtocols.Tls12 |
                               System.Security.Authentication.SslProtocols.Tls13;
        return handler;
    });

    builder.Services.AddDbContext<RegistrarDbContext>(options =>
        options.UseNpgsql(
            builder.Configuration.GetConnectionString("PostgresConnection")
            ?? "Host=127.0.0.1;Database=ActivityLogs;Username=BLOCKGO;Password=PLVBLOCKGO",
            npgsqlOptions => npgsqlOptions.CommandTimeout((int)TimeSpan.FromMinutes(5).TotalSeconds)));

    var app = builder.Build();

    app.UseSerilogRequestLogging();
    app.UseSwagger();
    app.UseSwaggerUI();
    app.UseCors("AllowFrontend");

    app.UseExceptionHandler(_ => { });
    app.UseRateLimiter();

    if (!app.Environment.IsDevelopment())
    {
        app.UseHsts();
        Log.Information("HSTS enabled (HTTPS Redirection disabled for Nginx)");
    }

    app.UseAuthorization();
    app.MapControllers();
    Log.Information("Application configured successfully");
    Log.Information("Listening on {Urls}", string.Join(", ", app.Urls));

    app.Run();
}
catch (Exception ex)
{
    Log.Fatal(ex, " Application terminated unexpectedly");
}
finally
{
    await Log.CloseAndFlushAsync();
}