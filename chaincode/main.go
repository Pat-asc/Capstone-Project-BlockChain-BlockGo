package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/hyperledger/fabric-chaincode-go/v2/pkg/cid"
	"github.com/hyperledger/fabric-chaincode-go/v2/shim"
	pb "github.com/hyperledger/fabric-protos-go-apiv2/peer"
)

type AcademicRecord struct {
	ID          string `json:"id"`
	StudentHash string `json:"student_hash"`
	StudentNo   string `json:"student_no"`
	StudentName string `json:"student_name"`
	Section     string `json:"section"`
	YearLevel   string `json:"year_level"`
	Course      string `json:"course"`
	SubjectCode string `json:"subject_code"`
	Grade       string `json:"grade"`
	Semester    string `json:"semester"`
	SchoolYear  string `json:"school_year"`
	FacultyID   string `json:"faculty_id"`
	Date        string `json:"date"`
	IpfsCID     string `json:"ipfs_cid"`
	University  string `json:"university"`
	Status      string `json:"status"`
	Note        string `json:"note"`
	Version     int    `json:"version"`
}

type SmartContract struct{}

func getSafeAttribute(stub shim.ChaincodeStubInterface, attrName string) (string, bool) {
	val, found, err := cid.GetAttributeValue(stub, attrName)
	if err != nil || !found {
		return "", false
	}
	return val, true
}

func (cc *SmartContract) Init(stub shim.ChaincodeStubInterface) *pb.Response {
	return shim.Success([]byte("OK"))
}

func (cc *SmartContract) Invoke(stub shim.ChaincodeStubInterface) *pb.Response {
	function, args := stub.GetFunctionAndParameters()

	switch function {
	case "InitLedger":
		return cc.initLedger(stub)
	case "IssueGrade":
		return cc.issueGrade(stub, args)
	case "IssueBatchGrades":
		return cc.issueBatchGrades(stub, args)
	case "ReturnGrade":
		return cc.returnGrade(stub, args)
	case "ReadGrade":
		return cc.readGrade(stub, args)
	case "UpdateGrade":
		return cc.updateGrade(stub, args)
	case "ApproveGrade":
		return cc.approveGrade(stub, args)
	case "FinalizeRecord":
		return cc.finalizeRecord(stub, args)
	case "GetAllGrades":
		return cc.getAllGrades(stub)
	case "GetGradeHistory":
		return cc.getGradeHistory(stub, args)
	default:
		return shim.Error("Invalid function name")
	}
}

func (cc *SmartContract) initLedger(stub shim.ChaincodeStubInterface) *pb.Response {
	records := []AcademicRecord{
		{
			ID:          "GENESIS-001",
			StudentHash: "genesis.student@plv.edu.ph",
			StudentNo:   "2024-0000",
			StudentName: "Genesis Student",
			Section:     "A",
			Course:      "BSCS",
			SubjectCode: "CS-GENESIS",
			Grade:       "1.00",
			Semester:    "1st Semester",
			SchoolYear:  "2024",
			FacultyID:   "system",
			Date:        "2024-01-01",
			University:  "PLV",
			Status:      "Finalized",
			Version:     1,
		},
	}

	for _, record := range records {
		recordJSON, err := json.Marshal(record)
		if err != nil {
			return shim.Error(fmt.Sprintf("Failed to marshal genesis record: %v", err))
		}
		if err := stub.PutState(record.ID, recordJSON); err != nil {
			return shim.Error(fmt.Sprintf("Failed to put state for genesis record: %v", err))
		}
	}
	return shim.Success([]byte("Ledger Initialized Successfully with Genesis Data"))
}

func (cc *SmartContract) issueGrade(stub shim.ChaincodeStubInterface, args []string) *pb.Response {
	if len(args) < 1 {
		return shim.Error("Record data required")
	}

	mspID, err := cid.GetMSPID(stub)
	if err != nil {
		return shim.Error(fmt.Sprintf("Failed to get MSP ID: %v", err))
	}
	if mspID != "FacultyMSP" && mspID != "DepartmentMSP" {
		return shim.Error(fmt.Sprintf("OBAC Denied: Must belong to Faculty or Department. Your MSP is %s", mspID))
	}
	role, found := getSafeAttribute(stub, "role")
	if !found || (role != "faculty" && role != "department_admin" && role != "deptAdmin") {
		return shim.Error("ABAC Denied: User lacks the cryptographic 'faculty' or 'department_admin' role.")
	}

	var record AcademicRecord
	if err := json.Unmarshal([]byte(args[0]), &record); err != nil {
		return shim.Error(fmt.Sprintf("Invalid JSON input: %v", err))
	}

	if record.Grade == "" {
		return shim.Error("Grade field cannot be empty")
	}

	existing, err := stub.GetState(record.ID)
	if err != nil {
		return shim.Error(fmt.Sprintf("Failed to read from state database: %v", err))
	}
	if existing != nil {
		return shim.Error("Record already exists")
	}

	submitterID, err := cid.GetID(stub)
	if err != nil {
		return shim.Error(fmt.Sprintf("Failed to get client identity: %v", err))
	}
	
	cert, err := cid.GetX509Certificate(stub)
	if err == nil && cert != nil {
		record.FacultyID = cert.Subject.CommonName
	} else {
		record.FacultyID = submitterID
	}
	record.Status = "Issued"
	record.Version = 1

	recordJSON, err := json.Marshal(record)
	if err != nil {
		return shim.Error(fmt.Sprintf("Failed to marshal record: %v", err))
	}
	if err := stub.PutState(record.ID, recordJSON); err != nil {
		return shim.Error(fmt.Sprintf("Failed to update state database: %v", err))
	}

	return shim.Success(recordJSON)
}

func (cc *SmartContract) issueBatchGrades(stub shim.ChaincodeStubInterface, args []string) *pb.Response {
	if len(args) < 1 {
		return shim.Error("Batch record data required")
	}

	mspID, err := cid.GetMSPID(stub)
	if err != nil {
		return shim.Error(fmt.Sprintf("Failed to get MSP ID: %v", err))
	}
	if mspID != "FacultyMSP" && mspID != "DepartmentMSP" {
		return shim.Error(fmt.Sprintf("OBAC Denied: Must belong to Faculty or Department. Your MSP is %s", mspID))
	}
	role, found := getSafeAttribute(stub, "role")
	if !found || (role != "faculty" && role != "department_admin" && role != "deptAdmin") {
		return shim.Error("ABAC Denied: User lacks the cryptographic 'faculty' or 'department_admin' role.")
	}

	var records []AcademicRecord
	err = json.Unmarshal([]byte(args[0]), &records)
	if err != nil {
		return shim.Error(fmt.Sprintf("Failed to unmarshal batch records: %v", err))
	}

	for _, record := range records {
		if record.ID == "" {
			continue
		}
		recordJSON, err := json.Marshal(record)
		if err != nil {
			return shim.Error(fmt.Sprintf("Failed to marshal record %s: %v", record.ID, err))
		}
		if err := stub.PutState(record.ID, recordJSON); err != nil {
			return shim.Error(fmt.Sprintf("Failed to put state for record %s: %v", record.ID, err))
		}
	}

	return shim.Success([]byte(fmt.Sprintf("Successfully processed %d records in batch", len(records))))
}

func (cc *SmartContract) returnGrade(stub shim.ChaincodeStubInterface, args []string) *pb.Response {
	if len(args) < 2 {
		return shim.Error("Record ID and Revision Note required")
	}

	mspID, _ := cid.GetMSPID(stub)
	role, found := getSafeAttribute(stub, "role")
	if !found || (mspID != "DepartmentMSP" && mspID != "RegistrarMSP") || (role != "department_admin" && role != "deptAdmin" && role != "registrar") {
		return shim.Error("OBAC/ABAC Denied: Only Department Admin or Registrar can return grades for revision")
	}

	recordID := args[0]
	note := args[1]

	recordJSON, err := stub.GetState(recordID)
	if err != nil || recordJSON == nil {
		return shim.Error("Record not found")
	}

	var record AcademicRecord
	json.Unmarshal(recordJSON, &record)

	record.Status = "Returned"
	record.Note = note
	record.Date = "2024-05-04" // Should ideally use stub timestamp or passed date
	record.Version++

	updatedJSON, _ := json.Marshal(record)
	stub.PutState(recordID, updatedJSON)

	return shim.Success(updatedJSON)
}

func (cc *SmartContract) readGrade(stub shim.ChaincodeStubInterface, args []string) *pb.Response {
	if len(args) < 1 {
		return shim.Error("ID required")
	}

	recordJSON, err := stub.GetState(args[0])
	if err != nil || recordJSON == nil {
		return shim.Error("Record not found")
	}

	return shim.Success(recordJSON)
}

func (cc *SmartContract) updateGrade(stub shim.ChaincodeStubInterface, args []string) *pb.Response {
	if len(args) < 1 {
		return shim.Error("Updated record required")
	}

	mspID, _ := cid.GetMSPID(stub)
	if mspID != "FacultyMSP" && mspID != "DepartmentMSP" {
		return shim.Error("OBAC Denied: Only Faculty or Department Admins can update their issued grades")
	}
	role, found := getSafeAttribute(stub, "role")
	if !found || (role != "faculty" && role != "department_admin" && role != "deptAdmin") {
		return shim.Error("ABAC Denied: Missing required role.")
	}

	var updated AcademicRecord
	if err := json.Unmarshal([]byte(args[0]), &updated); err != nil {
		return shim.Error(fmt.Sprintf("Failed to unmarshal updated record: %v", err))
	}

	// VALIDATION: Prevent empty grades from being submitted in an update.
	if updated.Grade == "" {
		return shim.Error("Grade field cannot be empty")
	}

	existingJSON, err := stub.GetState(updated.ID)
	if err != nil {
		return shim.Error(fmt.Sprintf("Failed to read from state database: %v", err))
	}
	if existingJSON == nil {
		return shim.Error("Record does not exist")
	}

	var existing AcademicRecord
	if err := json.Unmarshal(existingJSON, &existing); err != nil {
		return shim.Error(fmt.Sprintf("Failed to unmarshal existing record: %v", err))
	}

	// VALIDATION: Prevent modification of a finalized record.
	if existing.Status == "Finalized" {
		return shim.Error("Cannot update a grade that has been finalized")
	}

	submitterID, _ := cid.GetID(stub)
	var email string
	cert, err := cid.GetX509Certificate(stub)
	if err == nil && cert != nil {
		email = cert.Subject.CommonName
	}

	// Validate against both formats to support legacy records
	if existing.FacultyID != submitterID && existing.FacultyID != email {
		return shim.Error("Only the original professor who issued the grade can update it")
	}

	existing.Grade = updated.Grade
	existing.Date = updated.Date
	existing.Status = "Corrected"
	existing.Version++

	recordJSON, _ := json.Marshal(existing)
	if err := stub.PutState(existing.ID, recordJSON); err != nil {
		return shim.Error(fmt.Sprintf("Failed to update state database: %v", err))
	}

	return shim.Success(recordJSON)
}

func (cc *SmartContract) approveGrade(stub shim.ChaincodeStubInterface, args []string) *pb.Response {
	if len(args) < 1 {
		return shim.Error("Record ID required")
	}

	mspID, _ := cid.GetMSPID(stub)
	role, found := getSafeAttribute(stub, "role")
	
	if !found {
		return shim.Error("ABAC Denied: User role attribute not found.")
	}

	isDeptAdmin := mspID == "DepartmentMSP" && role == "department_admin"
	isRegistrar := mspID == "RegistrarMSP" && role == "registrar"

	if !isDeptAdmin && !isRegistrar {
		return shim.Error("OBAC/ABAC Denied: Only Department Admin or Registrar can approve grades.")
	}

	recordJSON, err := stub.GetState(args[0])
	if err != nil {
		return shim.Error(fmt.Sprintf("Failed to read from state database: %v", err))
	}
	if recordJSON == nil {
		return shim.Error("Record not found")
	}

	var record AcademicRecord
	if err := json.Unmarshal(recordJSON, &record); err != nil {
		return shim.Error(fmt.Sprintf("Failed to unmarshal record: %v", err))
	}

	record.Status = "DepartmentApproved"
	updatedJSON, _ := json.Marshal(record)
	if err := stub.PutState(args[0], updatedJSON); err != nil {
		return shim.Error(fmt.Sprintf("Failed to update state database: %v", err))
	}

	return shim.Success(updatedJSON)
}

func (cc *SmartContract) finalizeRecord(stub shim.ChaincodeStubInterface, args []string) *pb.Response {
	if len(args) < 1 {
		return shim.Error("Record ID required")
	}

	mspID, _ := cid.GetMSPID(stub)
	role, found := getSafeAttribute(stub, "role")
	
	if !found {
		return shim.Error("ABAC Denied: User role attribute not found.")
	}

	isRegistrar := mspID == "RegistrarMSP" && role == "registrar"

	if !isRegistrar {
		return shim.Error("OBAC/ABAC Denied: Only the Master Registrar can finalize records to the ledger.")
	}

	recordJSON, err := stub.GetState(args[0])
	if err != nil {
		return shim.Error(fmt.Sprintf("Failed to read from state database: %v", err))
	}
	if recordJSON == nil {
		return shim.Error("Record not found")
	}

	var record AcademicRecord
	if err := json.Unmarshal(recordJSON, &record); err != nil {
		return shim.Error(fmt.Sprintf("Failed to unmarshal record: %v", err))
	}

	record.Status = "Finalized"
	updatedJSON, _ := json.Marshal(record)
	if err := stub.PutState(args[0], updatedJSON); err != nil {
		return shim.Error(fmt.Sprintf("Failed to update state database: %v", err))
	}

	return shim.Success(updatedJSON)
}

func (cc *SmartContract) getAllGrades(stub shim.ChaincodeStubInterface) *pb.Response {
	// Use CouchDB Rich Query to avoid full state scan
	queryString := `{"selector":{"status":{"$ne":""}}}`
	resultsIterator, err := stub.GetQueryResult(queryString)
	if err != nil {
		return shim.Error("Query failed: " + err.Error())
	}
	defer resultsIterator.Close()

	var records []AcademicRecord
	for resultsIterator.HasNext() {
		queryResponse, err := resultsIterator.Next()
		if err != nil {
			return shim.Error(fmt.Sprintf("Failed to get next iteration: %v", err))
		}
		var record AcademicRecord
		if err := json.Unmarshal(queryResponse.Value, &record); err != nil {
			return shim.Error(fmt.Sprintf("Failed to unmarshal record: %v", err))
		}
		records = append(records, record)
	}

	recordsJSON, _ := json.Marshal(records)
	return shim.Success(recordsJSON)
}

func (cc *SmartContract) getGradeHistory(stub shim.ChaincodeStubInterface, args []string) *pb.Response {
	if len(args) < 1 {
		return shim.Error("Record ID required")
	}
	recordID := args[0]
	
	mspID, _ := cid.GetMSPID(stub)
	role, found := getSafeAttribute(stub, "role")
	
	if !found || (role == "student") {
		return shim.Error("ABAC Denied: Students cannot view the full audit history.")
	}
	if mspID != "RegistrarMSP" && mspID != "DepartmentMSP" && mspID != "FacultyMSP" {
		return shim.Error("OBAC Denied: Unauthorized organization.")
	}

	resultsIterator, err := stub.GetHistoryForKey(recordID)
	if err != nil {
		return shim.Error("Error retrieving grade history: " + err.Error())
	}
	defer resultsIterator.Close()

	var history []map[string]interface{}
	for resultsIterator.HasNext() {
		response, err := resultsIterator.Next()
		if err != nil {
			return shim.Error("Error processing history iteration: " + err.Error())
		}
		
		var value map[string]interface{}
		if len(response.Value) > 0 {
			err = json.Unmarshal(response.Value, &value)
			if err != nil {
				return shim.Error("Error unmarshalling history value: " + err.Error())
			}
		}

		historyRecord := map[string]interface{}{
			"txId":      response.TxId,
			"timestamp": response.Timestamp.String(),
			"isDelete":  response.IsDelete,
			"value":     value,
		}
		history = append(history, historyRecord)
	}

	historyJSON, _ := json.Marshal(history)
	return shim.Success(historyJSON)
}

func main() {
	fmt.Println("[CHAINCODE] Starting registrar chaincode...")
	
	tlsDisabled := os.Getenv("CHAINCODE_TLS_DISABLED") == "true"
	ccID := os.Getenv("CHAINCODE_ID")
	address := os.Getenv("CHAINCODE_SERVER_ADDRESS")
	
	fmt.Println("[CHAINCODE] Config: TLS=", !tlsDisabled, " ID=", ccID, " Address=", address)

	server := &shim.ChaincodeServer{
		CCID:    ccID,
		Address: address,
		CC:      new(SmartContract),
	}

	if tlsDisabled {
		fmt.Println("[CHAINCODE] TLS DISABLED")
		server.TLSProps = shim.TLSProperties{Disabled: true}
	} else {
		fmt.Println("[CHAINCODE] TLS ENABLED")
		server.TLSProps = shim.TLSProperties{
			Disabled:      false,
			Key:           readFile(os.Getenv("CHAINCODE_TLS_KEY_FILE")),
			Cert:          readFile(os.Getenv("CHAINCODE_TLS_CERT_FILE")),
		}
	}

	fmt.Println("[CHAINCODE] Starting server...")
	if err := server.Start(); err != nil {
		log.Fatalf("[CHAINCODE] Server start error: %v", err)
	}
	fmt.Println("[CHAINCODE] Server started successfully")
}

func readFile(path string) []byte {
	if path == "" {
		return nil
	}
	if info, err := os.Stat(path); err == nil && info.IsDir() {
		files, readDirErr := os.ReadDir(path)
		if readDirErr != nil {
			log.Fatalf("Failed to read directory %s: %v", path, readDirErr)
		}
		for _, f := range files {
			if !f.IsDir() && strings.HasSuffix(f.Name(), "_sk") {
				path = filepath.Join(path, f.Name())
				break
			}
		}
	}

	content, err := os.ReadFile(path)
	if err != nil {
		log.Fatalf("Failed to read file content from %s: %v", path, err)
	}
	return content
}