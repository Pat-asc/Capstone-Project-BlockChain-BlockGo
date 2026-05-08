namespace BlockGo.Models
{
    public class GradeCorrectionRequest
    {
        public string RecordID { get; set; } = string.Empty;
        public string OldGrade { get; set; } = string.Empty;
        public string NewGrade { get; set; } = string.Empty;
        public string ReasonText { get; set; } = string.Empty;
        public string ApprovedBy { get; set; } = string.Empty;
    }
}