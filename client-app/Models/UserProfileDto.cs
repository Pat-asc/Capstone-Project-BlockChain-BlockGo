using System.Collections.Generic;

namespace Client_app.Models
{
    public class UserProfileDto
    {
        public int Id { get; set; }
        public string Email { get; set; }
        public string FullName { get; set; }
        public string Role { get; set; }
        public string Status { get; set; }
        public string? Department { get; set; }
        public string? StudentNo { get; set; }
        public string? Section { get; set; }
        public string? DateOfBirth { get; set; } // mm/dd/yyyy format
        public string? YearLevel { get; set; }
        public List<string>? EnrolledSubjects { get; set; }
        // Add other profile-specific fields as needed
    }
}