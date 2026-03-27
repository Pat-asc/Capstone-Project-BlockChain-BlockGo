namespace Client_app.Models
{
    public class SignupRequest
    {
        public string FullName { get; set; }
        public string Email { get; set; }
        public string Password { get; set; }
        public string Role { get; set; }
        public string VerificationCode { get; set; }
        public string Department { get; set; }
        public string? StudentNo { get; set; }
    }
}