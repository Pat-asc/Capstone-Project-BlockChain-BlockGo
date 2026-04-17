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
	Section     string `json:"section"`
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
	default:
		return shim.Error("Invalid function name")
	}
}

func (cc *SmartContract) initLedger(stub shim.ChaincodeStubInterface) *pb.Response {
	records := []AcademicRecord{
		{
			ID:          "GENESIS-001",
			StudentHash: "genesis.student@plv.edu.ph",
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
	if mspID != "FacultyMSP" {
		return shim.Error(fmt.Sprintf("OBAC Denied: Must belong to FacultyMSP. Your MSP is %s", mspID))
	}
	role, found := getSafeAttribute(stub, "role")
	if !found || role != "faculty" {
		return shim.Error("ABAC Denied: User belongs to FacultyMSP, but lacks the cryptographic 'faculty' role.")
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
	record.FacultyID = submitterID
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
	if mspID != "FacultyMSP" {
		return shim.Error("OBAC Denied: Only FacultyMSP can update grades")
	}
	role, found := getSafeAttribute(stub, "role")
	if !found || role != "faculty" {
		return shim.Error("ABAC Denied: Missing 'faculty' role.")
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
	if existing.FacultyID != submitterID {
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
	resultsIterator, err := stub.GetStateByRange("", "")
	if err != nil {
		return shim.Error("Query failed")
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