import pandas as pd
import os

network_path = os.path.join(os.path.dirname(__file__), 'network', 'grades_mockup.xlsx')
df = pd.read_excel(network_path)

df_renamed = df.rename(columns={
    'student_id': 'StudentId',
    'course': 'Course',
    'section': 'Section',
    'subject_code': 'SubjectCode',
    'grade': 'Grade',
    'semester': 'Semester',
    'school_year': 'SchoolYear',
    'date': 'Date'
})

if 'FacultyId' not in df_renamed.columns:
    df_renamed['FacultyId'] = 'prof1@university.edu'

if 'StudentHash' not in df_renamed.columns:
    df_renamed['StudentHash'] = df_renamed['StudentId'].astype(str)

columns = ['StudentId', 'StudentHash', 'Grade', 'Course', 'FacultyId', 'Semester', 'SubjectCode', 'SchoolYear', 'Section']
df_final = df_renamed[[col for col in columns if col in df_renamed.columns]]

output_path = os.path.join(os.path.dirname(__file__), 'grades_mockup.csv')
df_final.to_csv(output_path, index=False)

print("CSV created successfully!")
print("\nData preview:")
print(df_final)
print(f"\nTotal records: {len(df_final)}")
