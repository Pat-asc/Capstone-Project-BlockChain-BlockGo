import sys
import os
import pandas as pd
import json
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), 'network', '.env'), override=True)

class GradeMapper:
    def __init__(self, csharp_api_url='http://localhost:5000', api_key=None):
        self.csharp_url = csharp_api_url
        self.api_endpoint = f"{csharp_api_url}/api/grades/bulk-upload"
        self.api_key = api_key or os.getenv('INTERNAL_API_KEY', 'default-internal-secret-change-me')

    def excel_to_csv(self, excel_path):
        try:
            try:
                import openpyxl
            except ImportError:
                print("Error: 'openpyxl' library is required to read .xlsx files.")
                print("Please install it using: pip install openpyxl")
                return None

            df = pd.read_excel(excel_path)
            csv_path = str(Path(excel_path).with_suffix('.csv'))
            df.to_csv(csv_path, index=False)
            print(f"Converted Excel to CSV: {csv_path}")
            return csv_path
        except Exception as e:
            print(f"Error: {e}")
            return None

    def validate_csv(self, csv_path):
        try:
            df = None
            # Try multiple encodings for CSV
            for encoding in ['utf-8', 'utf-8-sig', 'latin-1', 'iso-8859-1', 'cp1252']:
                try:
                    df = pd.read_csv(csv_path, encoding=encoding, on_bad_lines='skip')
                    break
                except (UnicodeDecodeError, pd.errors.ParserError):
                    continue
            
            if df is None:
                print(f"Failed to read CSV file with any common encoding.")
                return False
            
            df = df.dropna(how='all')
            if len(df) == 0:
                print(f"File has no valid data")
                return False
            
            df.columns = [str(col).lower().strip().replace(' ', '_') for col in df.columns]
            required = ['student_id', 'grade']
            has_required = all(col in df.columns for col in required)
            if not has_required:
                print(f"Missing required columns (expected 'student_id', 'grade'). Found: {list(df.columns)}")
                return False
            
            # Define the exact columns that the C# backend expects
            expected_columns = [
                'student_id', 'grade', 'course', 'section', 'subject_code',
                'semester', 'school_year', 'date', 'faculty_id', 'student_hash'
            ]
            
            # Filter out any extra junk columns not in our expected list
            columns_to_keep = [col for col in df.columns if col in expected_columns]
            df = df[columns_to_keep]
            
            # Save the cleaned, strictly-formatted data back to the CSV
            df.to_csv(csv_path, index=False)
            
            print(f"File validation passed: {len(df)} records. Filtered to {len(df.columns)} needed columns.")
            return True
        except Exception as e:
            print(f"File validation error: {e}")
            return False

    def upload(self, csv_path, faculty_id):
        if not Path(csv_path).exists():
            print(f"File not found: {csv_path}")
            return False
        
        try:
            print(f"Uploading to {self.api_endpoint}...")
            with open(csv_path, 'rb') as f:
                files = {'csvFile': (Path(csv_path).name, f, 'text/csv')}
                headers = {
                    'x-api-key': self.api_key,
                    'x-user-identity': faculty_id  # Pass faculty ID from login
                }
                response = requests.post(self.api_endpoint, files=files, headers=headers, timeout=120)
            
            if response.status_code in [200, 201]:
                result = response.json()
                print(f"Status: {result.get('status')}")
                print(f"Success: {result.get('successful')}/{result.get('totalProcessed')}")
                if result.get('failed', 0) > 0:
                    print(f"Failed: {result.get('failed')}")
                    if result.get('errors'):
                        for err in result['errors'][:3]:
                            print(f"  - {err.get('studentId')}: {err.get('reason')}")
                return result.get('failed', 0) == 0
            else:
                print(f"HTTP {response.status_code}: {response.text[:200]}")
                return False
        except Exception as e:
            print(f"Error: {e}")
            return False

def is_excel(file_path):
    """Check if a file is an Excel file by its magic number."""
    try:
        with open(file_path, 'rb') as f:
            signature = f.read(8)
            # XLSX (zip) starts with 'PK\x03\x04'
            # XLS (BIFF8) starts with '\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1'
            return signature.startswith(b'PK\x03\x04') or signature.startswith(b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1')
    except Exception:
        return False

def main():
    if len(sys.argv) < 3:
        print("Usage: python mapper_updated.py <csv_or_xlsx> [faculty_id] [api_key]")
        print("Error: Missing required arguments.")
        sys.exit(1)
    
    file_path = sys.argv[1]
    # Make faculty_id a required argument
    faculty_id = sys.argv[2]
    api_key = sys.argv[3] if len(sys.argv) > 3 else None

    if not Path(file_path).exists():
        print(f"File not found: {file_path}")
        sys.exit(1)
    
    mapper = GradeMapper(api_key=api_key)
    
    if is_excel(file_path):
        print("Excel file format detected.")
        path_to_process = mapper.excel_to_csv(file_path)
        if not path_to_process:
            print("Failed to convert Excel to CSV.")
            sys.exit(1)
    else:
        print("Assuming CSV file format.")
        path_to_process = file_path

    if mapper.validate_csv(path_to_process):
        success = mapper.upload(path_to_process, faculty_id)
        sys.exit(0 if success else 1)
    else:
        sys.exit(1)

if __name__ == "__main__":
    main()
