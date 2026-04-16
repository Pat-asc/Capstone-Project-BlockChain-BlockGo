import pandas as pd
import os

# Read Excel from network directory
network_path = os.path.join(os.path.dirname(__file__), 'network', 'grades_mockup.xlsx')
df = pd.read_excel(network_path)

# Rename columns to match system requirements
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

# Add required columns if missing
if 'FacultyId' not in df_renamed.columns:
    df_renamed['FacultyId'] = 'prof1@university.edu'

if 'StudentHash' not in df_renamed.columns:
    df_renamed['StudentHash'] = df_renamed['StudentId'].astype(str)

# Select columns in correct order
columns = ['StudentId', 'StudentHash', 'Grade', 'Course', 'FacultyId', 'Semester', 'SubjectCode', 'SchoolYear', 'Section']
df_final = df_renamed[[col for col in columns if col in df_renamed.columns]]

# Save to CSV in project root
output_path = os.path.join(os.path.dirname(__file__), 'grades_mockup.csv')
df_final.to_csv(output_path, index=False)

print("CSV created successfully!")
print("\nData preview:")
print(df_final)
print(f"\nTotal records: {len(df_final)}")
