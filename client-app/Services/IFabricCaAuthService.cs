namespace Client_app.Services
{
    public interface IFabricCaAuthService
    {
        string GenerateAuthToken(string method, string uri, string body);
    }
}