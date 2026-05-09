namespace Client_app.Models
{
    public class UsersRequest
    {
        public int RequestID { get; set; }
        public string? FullName { get; set; }
        public string? Email { get; set; }
        public string? Role { get; set; }
        public string? RequestStatus { get; set; }
    }
}