using System;
using System.Collections.Generic;

namespace For_Testing_Only_Capstone.Models;

public partial class Gradecorrectionlog
{
    public int Logid { get; set; }

    public string Recordid { get; set; } = string.Empty;

    public string? Oldgrade { get; set; }

    public string? Newgrade { get; set; }

    public string Reasontext { get; set; } = string.Empty;

    public string? Approvedby { get; set; }

    public DateTime? Timestamp { get; set; } = DateTime.UtcNow;
}