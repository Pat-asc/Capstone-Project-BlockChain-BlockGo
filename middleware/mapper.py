import sys
import pandas as pd
import hashlib
import json
import requests
import ipfshttpclient 

class DegreeMapper:
    def __init__(self, ipfs_api_url='/ip4/127.0.0.1/tcp/5001/http'):
        self.ipfs_url = ipfs_api_url
        self.university = "PLV"
        self.api_endpoint = "http://localhost:4000/api/issue-grade"

    def hash_student_id(self, student_id):
        secret_salt = "PLV_SECRET_SECRET1251"
        salted_id = f"{student_id}{secret_salt}"
        return hashlib.sha256(salted_id.encode()).hexdigest()

    def upload_to_ipfs(self, file_path):
        """Uploads the Grade Evidence PDF to Registrar"""
        try:
            with ipfshttpclient.connect(self.ipfs_url) as client:
                res = client.add(file_path)
                return res['Hash'] 
        except Exception as e:
            print(f"IPFS Upload Error: {e}")
            return "UPLOAD_FAILED"

    def process_excel(self, excel_path, pdf_evidence_path):
        try:
            df = pd.read_excel(excel_path)
        except Exception as e:
            print(f"Error reading Excel file: {e}")
            return []
        
        print("Uploading evidence to IPFS...")
        section_cid = self.upload_to_ipfs(pdf_evidence_path)
        print(f"Evidence secured. CID: {section_cid}\n")
        
        batch_records = []

        for index, row in df.iterrows():
            record_id = f"{row['course']}-{row['section']}-{row['student_id']}"
            
            degree_record = {
                "id": record_id,
                "student_hash": self.hash_student_id(str(row['student_id'])),
                "section": row['section'],
                "course": row['course'],
                "subject_code": row['subject_code'],
                "grade": str(row['grade']),
                "semester": row['semester'],
                "school_year": str(row['school_year']),
                "ipfs_cid": section_cid,
                "university": self.university,
                "date": str(row['date']), 
                "status": "Issued",
                "facultyId": "admin"
            }
            batch_records.append(degree_record)

        return batch_records

    def push_to_blockchain(self, batch_records, invoker_id="admin"):
        """Automatically pushes the processed records to the Node.js middleware"""
        success_count = 0
        for record in batch_records:
            try:
                headers = {'Content-Type': 'application/json', 'x-user-identity': invoker_id}
                response = requests.post(self.api_endpoint, json=record, headers=headers)
                
                if response.status_code == 201:
                    print(f"Successfully issued grade for {record['id']}")
                    success_count += 1
                else:
                    print(f"Failed to issue {record['id']}: {response.text}")
            except Exception as e:
                print(f"Network Error for {record['id']}: {e}")
                
        print(f"\nBatch Complete: {success_count}/{len(batch_records)} records secured on blockchain.")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python mapper.py <path_to_excel> <path_to_pdf>")
        sys.exit(1)
        
    excel_file = sys.argv[1]
    pdf_file = sys.argv[2]

    mapper = DegreeMapper()
    processed_data = mapper.process_excel(excel_file, pdf_file)
    
    if processed_data:
        print("Preview of first mapped record:")
        print(json.dumps(processed_data[0], indent=2))
        
        print("\nPushing records to Blockchain Middleware...")
        mapper.push_to_blockchain(processed_data, invoker_id="admin")
