import {
  buildCsvContent,
  buildStudentCsvContent,
  parseCsvRows,
  parseStudentIdSpreadsheet,
} from "./studentSectioningHelpers";

describe("studentSectioningHelpers", () => {
  it("parses Excel CSV rows with quoted commas and CRLF line endings", () => {
    const csv =
      'Student ID,Sex,Last Name,First Name,Middle Initial\r\n' +
      '26-0001,Male,"Dela, Cruz",Juan,A\r\n';

    expect(parseCsvRows(csv)).toEqual([
      ["Student ID", "Sex", "Last Name", "First Name", "Middle Initial"],
      ["26-0001", "Male", "Dela, Cruz", "Juan", "A"],
    ]);
  });

  it("imports registrar template rows into student records", () => {
    const csv = buildStudentCsvContent(
      [
        {
          studentId: "26-0001",
          sex: "Male",
          lastName: "Dela Cruz",
          firstName: "Juan",
          middleInitial: "A",
        },
      ],
      { includeYearLevel: false }
    );

    expect(parseStudentIdSpreadsheet(csv)).toEqual([
      {
        studentId: "26-0001",
        sex: "Male",
        lastName: "Dela Cruz",
        firstName: "Juan",
        middleInitial: "A",
        yearLevel: "1st Year",
        sectionCode: "",
      },
    ]);
  });

  it("accepts common student number and middle initial header aliases", () => {
    const csv =
      "student_no,gender,surname,given_name,mi,year\n" +
      "26-0002,Female,Santos,Maria,L,2nd Year\n";

    expect(parseStudentIdSpreadsheet(csv)[0]).toMatchObject({
      studentId: "26-0002",
      sex: "Female",
      lastName: "Santos",
      firstName: "Maria",
      middleInitial: "L",
      yearLevel: "2nd Year",
    });
  });

  it("escapes generated CSV values that contain commas", () => {
    expect(buildCsvContent([["department"], ["Bachelor, Sample"]])).toBe(
      'department\n"Bachelor, Sample"'
    );
  });
});
