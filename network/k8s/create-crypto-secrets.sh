#!/bin/bash
set +e

# MASTER ALIGNMENT: Match Docker Compose logic 1:1
CRYPTO_DIR="./crypto-config-final-v2"
CA_DIR="./fabric-ca"
NAMESPACE_MAIN="plv-main-campus"
NAMESPACE_ANNEX="plv-annex-campus"
NAMESPACE_PUBAD="plv-pubad-campus"

create_ca_secret() {
    local org=$1; local ns=$2
    local secret_name="ca-${org}-identity"
    local domain="${org}.capstone.com"
    local src_dir="./fabric-ca/${org}"
    
    # Find the exact private key that matches the CA certificate (bypasses Windows timestamp sorting issues)
    local keyfile=""
    for key in ${src_dir}/msp/keystore/*_sk; do
        local cert_pub=$(openssl x509 -in "${src_dir}/ca-cert.pem" -pubkey -noout 2>/dev/null)
        local key_pub=$(openssl ec -in "$key" -pubout 2>/dev/null)
        if [ "$cert_pub" = "$key_pub" ] && [ -n "$cert_pub" ]; then
            keyfile=$key
            break
        fi
    done
    if [ -z "$keyfile" ]; then
        keyfile=$(ls -tr ${src_dir}/msp/keystore/*_sk 2>/dev/null | head -n 1 || true)
    fi
    
    local tls_keyfile=""
    for key in ${src_dir}/msp/keystore/*_sk; do
        local tls_cert_pub=$(openssl x509 -in "${src_dir}/tls-cert.pem" -pubkey -noout 2>/dev/null)
        local key_pub=$(openssl ec -in "$key" -pubout 2>/dev/null)
        if [ "$tls_cert_pub" = "$key_pub" ] && [ -n "$tls_cert_pub" ]; then
            tls_keyfile=$key
            break
        fi
    done
    if [ -z "$tls_keyfile" ]; then
        tls_keyfile=$(ls -tr ${src_dir}/msp/keystore/*_sk 2>/dev/null | tail -n 1 || true)
    fi
    
    kubectl delete secret ${secret_name} -n ${ns} 2>/dev/null || true
    kubectl create secret generic ${secret_name} -n ${ns} \
        --from-file="ca-cert.pem=${src_dir}/ca-cert.pem" \
        --from-file="tls-cert.pem=${src_dir}/tls-cert.pem" \
        --from-file="ca-key.pem=${keyfile}" \
        --from-file="tls-key.pem=${tls_keyfile}"
}

create_middleware_ca_roots_secret() {
    local secret_name="fabric-ca-roots"
    kubectl delete secret ${secret_name} -n plv-fabric 2>/dev/null || true
    kubectl create secret generic ${secret_name} -n plv-fabric \
        --from-file="registrar-ca-cert.pem=./fabric-ca/registrar/ca-cert.pem" \
        --from-file="registrar-tls-cert.pem=./fabric-ca/registrar/tls-cert.pem" \
        --from-file="faculty-ca-cert.pem=./fabric-ca/faculty/ca-cert.pem" \
        --from-file="faculty-tls-cert.pem=./fabric-ca/faculty/tls-cert.pem" \
        --from-file="department-ca-cert.pem=./fabric-ca/department/ca-cert.pem" \
        --from-file="department-tls-cert.pem=./fabric-ca/department/tls-cert.pem"
}

create_node_secret() {
    local type=$1; local org=$2; local domain=$3; local ns=$4; local name=$5
    local secret_name="${type}-${org}-crypto"
    local path="${CRYPTO_DIR}/${type}Organizations/${domain}/${type}s/${name}"
    
    local signcert=$(ls ${path}/msp/signcerts/*.pem 2>/dev/null | head -n 1 || true)
    local keystore=$(ls ${path}/msp/keystore/*_sk 2>/dev/null | head -n 1 || true)
    if [ -z "$keystore" ]; then keystore="${path}/msp/keystore/priv_sk"; fi
    local cacert=$(ls ${path}/msp/cacerts/*.pem 2>/dev/null | head -n 1 || true)
    
    local admincert=""
    if [ "$type" == "orderer" ]; then
        admincert=$(ls ${CRYPTO_DIR}/peerOrganizations/registrar.capstone.com/users/Admin@registrar.capstone.com/msp/signcerts/*.pem 2>/dev/null | head -n 1 || true)
    else
        admincert=$(ls ${CRYPTO_DIR}/${type}Organizations/${domain}/users/Admin@${domain}/msp/signcerts/*.pem 2>/dev/null | head -n 1 || true)
    fi

    kubectl delete secret ${secret_name} -n ${ns} 2>/dev/null || true
    kubectl create secret generic ${secret_name} -n ${ns} \
        --from-file="server.crt=${path}/tls/server.crt" \
        --from-file="server.key=${path}/tls/server.key" \
        --from-file="ca.crt=${path}/tls/ca.crt" \
        --from-file="msp-cert.pem=${signcert}" \
        --from-file="msp-key.pem=${keystore}" \
        --from-file="msp-ca.pem=${cacert}" \
        --from-file="admin-cert.pem=${admincert}"
}

create_admin_secret() {
    local org=$1; local domain=$2; local ns=$3
    local secret_name="admin-${org}-crypto"
    local path="${CRYPTO_DIR}/peerOrganizations/${domain}/users/Admin@${domain}"
    
    local signcert=$(ls ${path}/msp/signcerts/*.pem 2>/dev/null | head -n 1 || true)
    local keystore=$(ls ${path}/msp/keystore/*_sk 2>/dev/null | head -n 1 || true)
    if [ -z "$keystore" ]; then keystore="${path}/msp/keystore/priv_sk"; fi
    local cacert=$(ls ${path}/msp/cacerts/*.pem 2>/dev/null | head -n 1 || true)

    kubectl delete secret ${secret_name} -n ${ns} 2>/dev/null || true
    kubectl create secret generic ${secret_name} -n ${ns} \
        --from-file="msp-cert.pem=${signcert}" \
        --from-file="msp-key.pem=${keystore}" \
        --from-file="msp-ca.pem=${cacert}" \
        --from-file="admin-cert.pem=${signcert}"
}

create_chaincode_tls_secret() {
    local org=$1; local ns=$2
    local secret_name="chaincode-${org}-tls"
    local path="${CRYPTO_DIR}/chaincode-tls"

    kubectl delete secret ${secret_name} -n ${ns} 2>/dev/null || true
    kubectl create secret generic ${secret_name} -n ${ns} \
        --from-file="server.crt=${path}/signcerts/server.crt" \
        --from-file="server.key=${path}/keystore/server.key" \
        --from-file="ca-bundle.pem=${path}/ca-bundle/ca-bundle.pem"
}

# 1. CAs
create_ca_secret "registrar" "${NAMESPACE_MAIN}"
create_ca_secret "faculty" "${NAMESPACE_ANNEX}"
create_ca_secret "department" "${NAMESPACE_PUBAD}"
create_middleware_ca_roots_secret

# 2. Orderers
create_node_secret "orderer" "1" "capstone.com" "${NAMESPACE_MAIN}" "orderer.capstone.com"
create_node_secret "orderer" "2" "capstone.com" "${NAMESPACE_MAIN}" "orderer2.capstone.com"
create_node_secret "orderer" "3" "capstone.com" "${NAMESPACE_ANNEX}" "orderer3.capstone.com"

# 3. Peers
create_node_secret "peer" "registrar" "registrar.capstone.com" "${NAMESPACE_MAIN}" "peer0.registrar.capstone.com"
create_node_secret "peer" "registrar-2" "registrar.capstone.com" "${NAMESPACE_MAIN}" "peer1.registrar.capstone.com"
create_node_secret "peer" "faculty" "faculty.capstone.com" "${NAMESPACE_ANNEX}" "peer0.faculty.capstone.com"
create_node_secret "peer" "faculty-2" "faculty.capstone.com" "${NAMESPACE_ANNEX}" "peer1.faculty.capstone.com"
create_node_secret "peer" "department" "department.capstone.com" "${NAMESPACE_PUBAD}" "peer0.department.capstone.com"
create_node_secret "peer" "department-2" "department.capstone.com" "${NAMESPACE_PUBAD}" "peer1.department.capstone.com"

# 4. Admins
create_admin_secret "registrar" "registrar.capstone.com" "${NAMESPACE_MAIN}"
create_admin_secret "faculty" "faculty.capstone.com" "${NAMESPACE_ANNEX}"
create_admin_secret "department" "department.capstone.com" "${NAMESPACE_PUBAD}"

# 5. Chaincode-as-a-Service TLS material
create_chaincode_tls_secret "registrar" "${NAMESPACE_MAIN}"
create_chaincode_tls_secret "faculty" "${NAMESPACE_ANNEX}"
create_chaincode_tls_secret "department" "${NAMESPACE_PUBAD}"

# 6. Artifacts
kubectl delete secret fabric-artifacts -n ${NAMESPACE_MAIN} 2>/dev/null || true
kubectl create secret generic fabric-artifacts -n ${NAMESPACE_MAIN} \
    --from-file=orderer.genesis.block=./channel-artifacts-final/orderer.genesis.block \
    --from-file=registrar-channel.block=./channel-artifacts-final/registrar-channel.block 2>/dev/null || true

kubectl delete secret fabric-artifacts -n ${NAMESPACE_ANNEX} 2>/dev/null || true
kubectl create secret generic fabric-artifacts -n ${NAMESPACE_ANNEX} \
    --from-file=orderer.genesis.block=./channel-artifacts-final/orderer.genesis.block \
    --from-file=registrar-channel.block=./channel-artifacts-final/registrar-channel.block 2>/dev/null || true

kubectl delete secret fabric-artifacts -n ${NAMESPACE_PUBAD} 2>/dev/null || true
kubectl create secret generic fabric-artifacts -n ${NAMESPACE_PUBAD} \
    --from-file=orderer.genesis.block=./channel-artifacts-final/orderer.genesis.block \
    --from-file=registrar-channel.block=./channel-artifacts-final/registrar-channel.block 2>/dev/null || true
