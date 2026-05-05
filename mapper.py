import sys
import os
import csv
import json
import requests
import ipfshttpclient
from pathlib import Path
from dotenv import load_dotenv
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import padding

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), 'network', '.env'), override=True)

class GradeMapper:
    def __init__(self, csharp_api_url='http://localhost:5000', api_key=None, ipfs_api_url='/ip4/127.0.0.1/tcp/5001/http'):
        self.csharp_url = csharp_api_url
        self.api_endpoint = f"{csharp_api_url}/api/grades/bulk-upload"
        self.api_key = api_key or os.getenv('INTERNAL_API_KEY')
        if not self.api_key:
            print("FATAL ERROR: INTERNAL_API_KEY environment variable is missing.")
            sys.exit(1)
        self.ipfs_url = os.getenv('IPFS_API_URL', ipfs_api_url)
        self.ipfs_client = None
        self.encryption_key = os.getenv('IPFS_ENCRYPTION_KEY', 'default-encryption-key-32chars!!!').ljust(32)[:32].encode()

    def encrypt_file(self, file_path):
        """Encrypt file with AES-256-CBC (Matching .NET Implementation)"""
        try:
            with open(file_path, 'rb') as f:
                data = f.read()
            
            # Padding
            padder = padding.PKCS7(128).padder()
            padded_data = padder.update(data) + padder.finalize()
            
            iv = b'\x00' * 16 # Matching .NET IV for simplicity in this project
            cipher = Cipher(algorithms.AES(self.encryption_key), modes.CBC(iv), backend=default_backend())
            encryptor = cipher.encryptor()
            encrypted_data = encryptor.update(padded_data) + encryptor.finalize()
            
            enc_path = file_path + ".enc"
            with open(enc_path, 'wb') as f:
                f.write(encrypted_data)
            return enc_path
        except Exception as e:
            print(f"Encryption Error: {e}")
            return None

    def connect_ipfs(self):
        """Establish IPFS connection"""
        try:
            self.ipfs_client = ipfshttpclient.connect(self.ipfs_url)
            print(f"Connected to IPFS at {self.ipfs_url}")
            return True
        except Exception as e:
            print(f"IPFS Connection Error: {e}")
            print(f"Make sure IPFS node is running at {self.ipfs_url}")
            return False

    def upload_to_ipfs(self, file_path):
        """Upload encrypted file to IPFS and return hash"""
        try:
            if not Path(file_path).exists():
                print(f"Error: File not found: {file_path}")
                return "FILE_NOT_FOUND"
            
            enc_path = self.encrypt_file(file_path)
            if not enc_path:
                return "ENCRYPTION_FAILED"

            if not self.ipfs_client:
                if not self.connect_ipfs():
                    return "CONNECTION_FAILED"
            
            try:
                res = self.ipfs_client.add(enc_path)
                cid = res['Hash']
                
                if enc_path.endswith(".enc"):
                    os.remove(enc_path)
                    
                return cid
            except Exception as e:
                print(f"IPFS API Error: {e}")
                return "UPLOAD_FAILED"
            
        except Exception as e:
            print(f"IPFS Upload Error: {e}")
            return "UPLOAD_FAILED"

    def excel_to_csv(self, excel_path):
        try:
            try:
                import openpyxl
            except ImportError:
                print("Error: 'openpyxl' library is required to read .xlsx files.")
                print("Please install it using: pip install openpyxl")
                return None

            wb = openpyxl.load_workbook(excel_path, data_only=True)
            sheet = wb.active
            csv_path = str(Path(excel_path).with_suffix('.csv'))
            
            with open(csv_path, 'w', encoding='utf-8', newline='') as f:
                writer = csv.writer(f)
                for row in sheet.iter_rows(values_only=True):
                    writer.writerow(row)
                    
            print(f"Converted Excel to CSV: {csv_path}")
            return csv_path
        except Exception as e:
            print(f"Error: {e}")
            return None

    def validate_csv(self, csv_path, ipfs_cid=None):
        try:
            expected_columns = [
                'student_id', 'grade', 'course', 'section', 'subject_code',
                'semester', 'school_year', 'date', 'faculty_id', 'student_hash', 'ipfs_cid'
            ]
            
            rows = []
            
            with open(csv_path, 'r', encoding='utf-8-sig') as f:
                reader = csv.reader(f)
                try:
                    headers = next(reader)
                except StopIteration:
                    print("File has no valid data")
                    return False
                    
                normalized_headers = [str(col).lower().strip().replace(' ', '_') for col in headers]
                
                # Map alternate names to expected ones
                header_mapping = {
                    'student_no': 'student_id',
                    'id_number': 'student_id',
                    'studentid': 'student_id',
                    'id': 'student_id',
                    'subject': 'subject_code',
                    'course_code': 'subject_code',
                    'final_grade': 'grade',
                    'course_name': 'course',
                    'program': 'course',
                    'sec': 'section',
                    'class_section': 'section'
                }
                normalized_headers = [header_mapping.get(col, col) for col in normalized_headers]

                if 'student_id' not in normalized_headers or 'grade' not in normalized_headers:
                    print(f"Missing required columns (expected 'student_id', 'grade'). Found: {normalized_headers}")
                    return False
                
                for row in reader:
                    if not any(row): continue
                    
                    row_dict = dict(zip(normalized_headers, row))
                    new_row = {}
                    for col in expected_columns:
                        if col == 'ipfs_cid':
                            new_row[col] = ipfs_cid if ipfs_cid and ipfs_cid not in ["CONNECTION_FAILED", "UPLOAD_FAILED", "FILE_NOT_FOUND"] else "N/A"
                        else:
                            new_row[col] = row_dict.get(col, "")
                    rows.append(new_row)

            if len(rows) == 0:
                print(f"File has no valid data")
                return False
            
            with open(csv_path, 'w', encoding='utf-8', newline='') as f:
                writer = csv.DictWriter(f, fieldnames=expected_columns)
                writer.writeheader()
                writer.writerows(rows)
                
            print(f"File validation passed: {len(rows)} records. Filtered to {len(expected_columns)} needed columns.")
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
                files = {'file': (Path(csv_path).name, f, 'text/csv')}
                headers = {
                    'x-api-key': self.api_key,
                    'x-user-identity': faculty_id
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
            return signature.startswith(b'PK\x03\x04') or signature.startswith(b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1')
    except Exception:
        return False

def main():
    if len(sys.argv) < 3:
        print("Usage: python mapper.py <csv_or_xlsx> [faculty_id] [api_key]")
        print("Error: Missing required arguments.")
        sys.exit(1)
    
    file_path = sys.argv[1]
    faculty_id = sys.argv[2]
    api_key = sys.argv[3] if len(sys.argv) > 3 else None

    if not Path(file_path).exists():
        print(f"File not found: {file_path}")
        sys.exit(1)
    
    mapper = GradeMapper(api_key=api_key)
    
    print("Uploading grading sheet to IPFS...")
    ipfs_cid = mapper.upload_to_ipfs(file_path)
    print(f"File secured on IPFS. CID: {ipfs_cid}")
    
    if is_excel(file_path):
        print("Excel file format detected.")
        path_to_process = mapper.excel_to_csv(file_path)
        if not path_to_process:
            print("Failed to convert Excel to CSV.")
            sys.exit(1)
    else:
        print("Assuming CSV file format.")
        path_to_process = file_path

    if mapper.validate_csv(path_to_process, ipfs_cid):
        success = mapper.upload(path_to_process, faculty_id)
        sys.exit(0 if success else 1)
    else:
        sys.exit(1)

if __name__ == "__main__":
    main()
