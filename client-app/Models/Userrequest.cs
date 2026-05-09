using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace For_Testing_Only_Capstone.Models;

[Table("userrequests")] 
public partial class Userrequest
{
    [Key]
    [Column("requestid")]
    public int Requestid { get; set; }

    [Column("fullname")]
    public string Fullname { get; set; } = null!;

    [Column("email")]
    public string Email { get; set; } = null!;

    [Column("role")]
    public string? Role { get; set; }

    [Column("department")]
    public string? Department { get; set; }

    [Column("requeststatus")]
    public string? Requeststatus { get; set; }

    [Column("createdat")]
    public DateTime? Createdat { get; set; }
}