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
    local src_dir="${CRYPTO_DIR}/peerOrganizations/${domain}/ca"
    local tlsca_dir="${CRYPTO_DIR}/peerOrganizations/${domain}/tlsca"
    
    kubectl delete secret ${secret_name} -n ${ns} 2>/dev/null || true
    kubectl create secret generic ${secret_name} -n ${ns} \
        --from-file=ca-cert.pem=${src_dir}/ca.${domain}-cert.pem \
        --from-file=tls-cert.pem=${src_dir}/ca.${domain}-cert.pem \
        --from-file=ca-key.pem=$(ls ${src_dir}/*_sk | head -n 1)
}

create_middleware_ca_roots_secret() {
    local secret_name="fabric-ca-roots"
    kubectl delete secret ${secret_name} -n plv-fabric 2>/dev/null || true
    kubectl create secret generic ${secret_name} -n plv-fabric \
        --from-file=registrar-ca-cert.pem=${CRYPTO_DIR}/peerOrganizations/registrar.capstone.com/ca/ca.registrar.capstone.com-cert.pem \
        --from-file=registrar-tls-cert.pem=${CRYPTO_DIR}/peerOrganizations/registrar.capstone.com/ca/ca.registrar.capstone.com-cert.pem \
        --from-file=faculty-ca-cert.pem=${CRYPTO_DIR}/peerOrganizations/faculty.capstone.com/ca/ca.faculty.capstone.com-cert.pem \
        --from-file=faculty-tls-cert.pem=${CRYPTO_DIR}/peerOrganizations/faculty.capstone.com/ca/ca.faculty.capstone.com-cert.pem \
        --from-file=department-ca-cert.pem=${CRYPTO_DIR}/peerOrganizations/department.capstone.com/ca/ca.department.capstone.com-cert.pem \
        --from-file=department-tls-cert.pem=${CRYPTO_DIR}/peerOrganizations/department.capstone.com/ca/ca.department.capstone.com-cert.pem
}

create_node_secret() {
    local type=$1; local org=$2; local domain=$3; local ns=$4; local name=$5
    local secret_name="${type}-${org}-crypto"
    local path="${CRYPTO_DIR}/${type}Organizations/${domain}/${type}s/${name}"
    
    kubectl delete secret ${secret_name} -n ${ns} 2>/dev/null || true
    # Use keys that match the filenames in your Docker environment
    kubectl create secret generic ${secret_name} -n ${ns} \
        --from-file=server.crt=${path}/tls/server.crt \
        --from-file=server.key=${path}/tls/server.key \
        --from-file=ca.crt=${path}/tls/ca.crt \
        --from-file=msp-cert.pem=$(ls ${path}/msp/signcerts/*.pem | head -n 1) \
        --from-file=msp-key.pem=$(ls ${path}/msp/keystore/*_sk 2>/dev/null || ls ${path}/msp/keystore/priv_sk) \
        --from-file=msp-ca.pem=$(ls ${path}/msp/cacerts/*.pem | head -n 1) \
        --from-file=admin-cert.pem=$(ls ${CRYPTO_DIR}/${type}Organizations/${domain}/users/Admin@${domain}/msp/signcerts/*.pem | head -n 1)
}

create_admin_secret() {
    local org=$1; local domain=$2; local ns=$3
    local secret_name="admin-${org}-crypto"
    local path="${CRYPTO_DIR}/peerOrganizations/${domain}/users/Admin@${domain}"
    
    kubectl delete secret ${secret_name} -n ${ns} 2>/dev/null || true
    kubectl create secret generic ${secret_name} -n ${ns} \
        --from-file=msp-cert.pem=$(ls ${path}/msp/signcerts/*.pem | head -n 1) \
        --from-file=msp-key.pem=$(ls ${path}/msp/keystore/*_sk 2>/dev/null || ls ${path}/msp/keystore/priv_sk) \
        --from-file=msp-ca.pem=$(ls ${path}/msp/cacerts/*.pem | head -n 1) \
        --from-file=admin-cert.pem=$(ls ${path}/msp/signcerts/*.pem | head -n 1)
}

create_chaincode_tls_secret() {
    local org=$1; local ns=$2
    local secret_name="chaincode-${org}-tls"
    local path="${CRYPTO_DIR}/chaincode-tls"

    kubectl delete secret ${secret_name} -n ${ns} 2>/dev/null || true
    kubectl create secret generic ${secret_name} -n ${ns} \
        --from-file=server.crt=${path}/signcerts/server.crt \
        --from-file=server.key=${path}/keystore/server.key \
        --from-file=ca-bundle.pem=${path}/ca-bundle/ca-bundle.pem
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
