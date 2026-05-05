using System.Text.Json.Serialization;

namespace BlockGo.Models
{
    public class AcademicRecord
    {
        [JsonPropertyName("id")]
        public string Id { get; set; } = string.Empty;

        [JsonPropertyName("student_hash")]
        public string StudentHash { get; set; } = string.Empty;

        [JsonPropertyName("section")]
        public string Section { get; set; } = string.Empty;

        [JsonPropertyName("year_level")]
        public string YearLevel { get; set; } = string.Empty;

        [JsonPropertyName("course")]
        public string Course { get; set; } = string.Empty;

        [JsonPropertyName("subject_code")]
        public string SubjectCode { get; set; } = string.Empty;

        [JsonPropertyName("grade")]
        public string Grade { get; set; } = string.Empty;

        [JsonPropertyName("semester")]
        public string Semester { get; set; } = string.Empty;

        [JsonPropertyName("school_year")]
        public string SchoolYear { get; set; } = string.Empty;

        [JsonPropertyName("faculty_id")]
        public string FacultyId { get; set; } = string.Empty;

        [JsonPropertyName("date")]
        public string Date { get; set; } = string.Empty;

        [JsonPropertyName("ipfs_cid")]
        public string IpfsCid { get; set; } = string.Empty;

        [JsonPropertyName("university")]
        public string University { get; set; } = string.Empty;

        [JsonPropertyName("status")]
        public string Status { get; set; } = string.Empty;

        [JsonPropertyName("note")]
        public string? Note { get; set; }

        [JsonPropertyName("version")]
        public int Version { get; set; }
    }
}