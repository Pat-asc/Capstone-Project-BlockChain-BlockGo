using Serilog;
using BlockGo.Services;
using Microsoft.EntityFrameworkCore;
using System.Threading.RateLimiting;
using Client_app.Services;
using Client_app.Middleware;
using Client_app.Models;
using Client_app.Controllers;
using For_Testing_Only_Capstone.Models;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using System.Text;

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
    
    string[] envPaths = { 
        Path.Combine(Directory.GetCurrentDirectory(), ".env"),
        Path.Combine(Directory.GetCurrentDirectory(), "..", "network", ".env"),
        Path.Combine(Directory.GetCurrentDirectory(), "..", "middleware", ".env")
    };

    foreach (var envPath in envPaths)
    {
        if (File.Exists(envPath))
        {
            foreach (var line in File.ReadAllLines(envPath))
            {
                var trimmedLine = line.Trim();
                if (string.IsNullOrWhiteSpace(trimmedLine) || trimmedLine.StartsWith("#")) continue;
                if (trimmedLine.StartsWith("export ")) trimmedLine = trimmedLine.Substring(7).Trim();
                
                var parts = trimmedLine.Split('=', 2, StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length == 2)
                {
                    var key = parts[0].Trim();
                    var value = parts[1].Split('#')[0].Trim().Trim('"', '\'');
                    
                    if (value.Contains("prefer-standby", StringComparison.OrdinalIgnoreCase)) 
                        value = System.Text.RegularExpressions.Regex.Replace(value, @"(?i)prefer-standby", "PreferStandby");
                    value = System.Text.RegularExpressions.Regex.Replace(value, @"(?i)target[\s_]*session[\s_]*attributes\s*=\s*[^;]+;?", "");
                    
                    if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable(key)))
                    {
                        Environment.SetEnvironmentVariable(key, value);
                    }
                }
            }
        }
    }

    foreach (System.Collections.DictionaryEntry env in Environment.GetEnvironmentVariables())
    {
        var key = env.Key?.ToString();
        var value = env.Value?.ToString();
        if (!string.IsNullOrEmpty(key) && !string.IsNullOrEmpty(value))
        {
            bool mutated = false;
            if (value.IndexOf("prefer-standby", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                value = System.Text.RegularExpressions.Regex.Replace(value, @"(?i)prefer-standby", "PreferStandby");
                mutated = true;
            }
            if (value.IndexOf("target", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                var newVal = System.Text.RegularExpressions.Regex.Replace(value, @"(?i)target[\s_]*session[\s_]*attributes\s*=\s*[^;]+;?", "");
                if (newVal != value) { value = newVal; mutated = true; }
            }
            if (mutated) Environment.SetEnvironmentVariable(key, value);
        }
    }

    Environment.SetEnvironmentVariable("PGTARGETSESSIONATTRS", null);
    Environment.SetEnvironmentVariable("PGTARGETSESSIONATTR", null);

    var builder = WebApplication.CreateBuilder(args);
    builder.WebHost.UseUrls("http://0.0.0.0:5000"); // Ensure C# binds correctly for Nginx to reach it
    builder.Host.UseSerilog();


    var masterConn = builder.Configuration.GetConnectionString("MasterConnection");
    var replicaConn = builder.Configuration.GetConnectionString("ReplicaConnection");
    var postgresConn = builder.Configuration.GetConnectionString("PostgresConnection");
    var stripRegex = new System.Text.RegularExpressions.Regex(@"(?i)target[\s_]*session[\s_]*attributes\s*=\s*[^;]+;?");
    var configOverrides = new Dictionary<string, string?>();
    if (!string.IsNullOrEmpty(masterConn)) configOverrides["ConnectionStrings:MasterConnection"] = stripRegex.Replace(masterConn, "");
    if (!string.IsNullOrEmpty(replicaConn)) configOverrides["ConnectionStrings:ReplicaConnection"] = stripRegex.Replace(replicaConn, "");
    if (!string.IsNullOrEmpty(postgresConn)) configOverrides["ConnectionStrings:PostgresConnection"] = stripRegex.Replace(postgresConn, "");

    var internalApiKey = Environment.GetEnvironmentVariable("INTERNAL_API_KEY");
    if (!string.IsNullOrEmpty(internalApiKey)) configOverrides["InternalApiKey"] = internalApiKey;

    builder.Configuration.AddInMemoryCollection(configOverrides);

    builder.Services.AddCors(options =>
    {
        options.AddPolicy("AllowFrontend", policy =>
        {
            policy.WithOrigins("http://localhost:8080", "http://localhost:3000") 
                  .WithMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                  .WithHeaders("Content-Type", "Authorization", "x-user-identity", "x-api-key")
                  .AllowCredentials();
        });
    });

    builder.Services.AddControllers();
    builder.Services.AddMemoryCache();
    builder.Services.AddEndpointsApiExplorer();
    builder.Services.AddSwaggerGen();
    builder.Services.AddSignalR(options =>
    {
        // Chat attachments are sent through SignalR as base64. 5MB files expand to
        // roughly 6.7MB, so keep the hub receive limit above that payload size.
        options.MaximumReceiveMessageSize = 8 * 1024 * 1024;
    });

    builder.Services.AddExceptionHandler<GlobalExceptionHandler>();
    builder.Services.AddProblemDetails();

    var jwtSecret = Environment.GetEnvironmentVariable("JWT_SECRET") ?? throw new InvalidOperationException("JWT_SECRET environment variable is required.");
    jwtSecret = jwtSecret.Trim().PadRight(32, '0').Substring(0, 32);
    var jwtKey = Encoding.UTF8.GetBytes(jwtSecret);

    builder.Services.AddAuthorization();
    builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.RequireHttpsMetadata = false;
        options.SaveToken = true;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(jwtKey),
            ValidateIssuer = false,
            ValidateAudience = false,
            NameClaimType = "username",
            RoleClaimType = "dbRole"
        };
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var accessToken = context.Request.Query["access_token"];
                var path = context.HttpContext.Request.Path;
                if (!string.IsNullOrEmpty(accessToken) && 
                    (path.StartsWithSegments("/chatHub") || path.StartsWithSegments("/api/chatHub") || path.StartsWithSegments("/api/Grades/view-ipfs")))
                {
                    context.Token = accessToken;
                }
                return Task.CompletedTask;
            }
        };
    });

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
    builder.Services.AddSingleton<IChatMessageEncryption, ChatMessageEncryption>();

    builder.Services.AddHttpClient("FabricCAClient")
    .ConfigurePrimaryHttpMessageHandler(() =>
    {
        var handler = new HttpClientHandler();
        bool allowInsecure = builder.Environment.IsDevelopment() || 
                             builder.Configuration.GetValue<bool>("Security:AllowInsecureTls");

        if (allowInsecure)
        {
            Log.Warning("internal Fabric CA connection: SSL validation BYPASSED (Development or Config Override)");
            handler.ServerCertificateCustomValidationCallback = (message, cert, chain, errors) => true;
        }
        else
        {
            Log.Information("internal Fabric CA connection: Strict SSL validation ENABLED (Production Mode)");
            handler.ServerCertificateCustomValidationCallback = null; 
        }

        handler.SslProtocols = System.Security.Authentication.SslProtocols.Tls12 |
                               System.Security.Authentication.SslProtocols.Tls13;
        return handler;
    });

    builder.Services.AddDbContext<RegistrarWriteDbContext>(options =>
    {
        var connectionString = builder.Configuration.GetConnectionString("MasterConnection");
        
        if (string.IsNullOrEmpty(connectionString))
        {
            throw new InvalidOperationException("PostgreSQL connection string 'MasterConnection' not found in configuration.");
        }
        options.UseNpgsql(connectionString, npgsqlOptions => npgsqlOptions.CommandTimeout((int)TimeSpan.FromMinutes(5).TotalSeconds));
    });

    builder.Services.AddDbContext<RegistrarReadDbContext>(options =>
    {
        var connectionString = builder.Configuration.GetConnectionString("ReplicaConnection");
        
        if (string.IsNullOrEmpty(connectionString))
        {
            throw new InvalidOperationException("PostgreSQL connection string 'ReplicaConnection' not found in configuration.");
        }
        options.UseNpgsql(connectionString, npgsqlOptions => npgsqlOptions.CommandTimeout((int)TimeSpan.FromMinutes(5).TotalSeconds));
    });

    builder.Services.AddScoped<RegistrarDbContext>(provider => provider.GetRequiredService<RegistrarWriteDbContext>());

    builder.Services.AddSingleton<IChatCache, ChatCache>(); 

    var app = builder.Build();

    app.UseExceptionHandler();
    app.UseSerilogRequestLogging();
    app.UseSwagger();
    app.UseSwaggerUI();
    app.UseCors("AllowFrontend");

    app.UseRateLimiter();
    
    if (!app.Environment.IsDevelopment())
    {
        app.UseHsts();
        Log.Information("HSTS enabled (HTTPS Redirection disabled for Nginx)");
    }

    app.UseAuthentication();
    app.UseAuthorization();
    app.MapControllers();
    Log.Information("Application configured successfully");
    Log.Information("Listening on {Urls}", string.Join(", ", app.Urls));
    app.MapHub<ChatHub>("/chatHub");
    app.MapHub<ChatHub>("/api/chatHub");

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
