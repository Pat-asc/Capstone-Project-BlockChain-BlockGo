FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

COPY For_Testing_Only_Capstone.csproj ./
RUN dotnet restore

COPY . ./
RUN dotnet publish For_Testing_Only_Capstone.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/publish ./

ENV ASPNETCORE_URLS=http://0.0.0.0:5000 \
    DOTNET_RUNNING_IN_CONTAINER=true

EXPOSE 5000

HEALTHCHECK --interval=15s --timeout=5s --start-period=45s --retries=3 \
    CMD curl -fsS http://127.0.0.1:5000/health || exit 1

ENTRYPOINT ["dotnet", "For_Testing_Only_Capstone.dll"]
