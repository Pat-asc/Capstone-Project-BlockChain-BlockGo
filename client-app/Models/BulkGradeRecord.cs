using System;
using System.Collections.Generic;
using CsvHelper.Configuration;

namespace Client_app.Models
{
    public class BulkGradeRecord
    {
        public string student_id { get; set; }
        public string course { get; set; }
        public string section { get; set; }
        public string subject_code { get; set; }
        public string grade { get; set; }
        public string semester { get; set; }
        public string school_year { get; set; }
        public string date { get; set; }
    }

    public class BulkUploadError
    {
        public string StudentId { get; set; }
        public string Reason { get; set; }
    }

    public class BulkGradeRecordMap : ClassMap<BulkGradeRecord>
    {
        public BulkGradeRecordMap()
        {
            Map(m => m.student_id).Name("student_id").Optional();
            Map(m => m.course).Name("course").Optional();
            Map(m => m.section).Name("section").Optional();
            Map(m => m.subject_code).Name("subject_code").Optional();
            Map(m => m.grade).Name("grade").Optional();
            Map(m => m.semester).Name("semester").Optional();
            Map(m => m.school_year).Name("school_year").Optional();
            Map(m => m.date).Name("date").Optional();
        }
    }
}
