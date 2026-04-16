using BlockGo.Models;
using Client_app.Models;
using For_Testing_Only_Capstone.Models;

namespace BlockGo.Mappers
{
    public static class GradeMapper
    {
        public static AcademicRecord ToBlockchainRecord(this GradeRequest request, string university = "PLV")
        {
            string uniqueRecordId = $"{request.StudentId}-{request.SubjectCode}-{request.Semester}";
            return new AcademicRecord
            {
                Id = uniqueRecordId, 
                StudentHash = request.StudentHash,
                Section = request.Section,
                Course = request.SubjectName,
                SubjectCode = request.SubjectCode,
                Grade = request.Grade,
                Semester = request.Semester,
                SchoolYear = request.SchoolYear,
                FacultyId = request.FacultyId,
                Date = request.Date,
                University = university,
                Status = "RECORDED",
                Version = 1
            };
        }

        public static Gradecorrectionlog ToInitialLog(this GradeRequest request)
        {
            return new Gradecorrectionlog
            {
                Recordid = request.StudentId,
                Newgrade = request.Grade,
                Reasontext = "Initial Grade Recording",
                Approvedby = request.FacultyId,
                Timestamp = DateTime.UtcNow
            };
        }
    }
}