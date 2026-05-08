using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Numerics;
using Microsoft.Extensions.Configuration;

namespace Client_app.Services
{
    public class FabricCaAuthService : IFabricCaAuthService
    {
        private readonly IConfiguration _configuration;

        public FabricCaAuthService(IConfiguration configuration)
        {
            _configuration = configuration;
        }

        public string GenerateAuthToken(string method, string uri, string body)
        {
            var certPath = _configuration["FabricCA:AdminCertPath"];
            var keyPath = _configuration["FabricCA:AdminKeyPath"];

            if (string.IsNullOrEmpty(certPath)) throw new Exception("FabricCA:AdminCertPath not configured");
            if (string.IsNullOrEmpty(keyPath)) throw new Exception("FabricCA:AdminKeyPath not configured");
            if (!File.Exists(certPath)) throw new Exception($"Cert not found at: {certPath}");
            if (!File.Exists(keyPath)) throw new Exception($"Private key not found at: {keyPath}");

            string privateKeyPem = File.ReadAllText(keyPath).Replace("\r\n", "\n");
            string certPem = File.ReadAllText(certPath).Replace("\r\n", "\n");

            string certBase64 = ExtractCertBase64(certPem);
            
            string b64Body = string.IsNullOrEmpty(body) 
                ? "" 
                : Convert.ToBase64String(Encoding.UTF8.GetBytes(body));

            string signString = b64Body + "." + certBase64;

            using var ecdsa = ECDsa.Create();
            ecdsa.ImportFromPem(privateKeyPem);

            byte[] rawSignature = ecdsa.SignData(Encoding.UTF8.GetBytes(signString), HashAlgorithmName.SHA256);
            byte[] lowSSignature = EnforceLowSCanonical(rawSignature);
            byte[] derSignature = ConvertRawToDer(lowSSignature);

            string finalToken = $"{certBase64}.{Convert.ToBase64String(derSignature)}";
            return finalToken.Replace("\n", "").Replace("\r", "").Replace(" ", "").Trim();
        }

        private string ExtractCertBase64(string certPem)
        {
            return Convert.ToBase64String(Encoding.UTF8.GetBytes(certPem))
                .Replace("\n", "").Replace("\r", "").Replace(" ", "");
        }

        private byte[] EnforceLowSCanonical(byte[] rawSignature)
        {
            if (rawSignature.Length != 64) throw new InvalidOperationException("Invalid ECDSA signature length");

            byte[] rBytes = rawSignature.Take(32).ToArray();
            byte[] sBytes = rawSignature.Skip(32).ToArray();

            var s = new BigInteger(sBytes, isUnsigned: true, isBigEndian: true);
            var n = BigInteger.Parse("00FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551", System.Globalization.NumberStyles.HexNumber);
            var halfN = n >> 1;

            if (s.CompareTo(halfN) > 0)
            {
                s = n - s;
                byte[] newSBytes = s.ToByteArray(isUnsigned: true, isBigEndian: true);
                
                if (newSBytes.Length < 32)
                {
                    byte[] padded = new byte[32];
                    Array.Copy(newSBytes, 0, padded, 32 - newSBytes.Length, newSBytes.Length);
                    newSBytes = padded;
                }

                byte[] result = new byte[64];
                Array.Copy(rBytes, 0, result, 0, 32);
                Array.Copy(newSBytes, 0, result, 32, 32);
                return result;
            }

            return rawSignature;
        }

        private byte[] ConvertRawToDer(byte[] rawSignature)
        {
            byte[] rBytes = rawSignature.Take(32).ToArray();
            byte[] sBytes = rawSignature.Skip(32).ToArray();

            byte[] derR = EncodeDerInteger(rBytes);
            byte[] derS = EncodeDerInteger(sBytes);

            byte[] result = new byte[2 + derR.Length + derS.Length];
            result[0] = 0x30; 
            result[1] = (byte)(derR.Length + derS.Length);
            Array.Copy(derR, 0, result, 2, derR.Length);
            Array.Copy(derS, 0, result, 2 + derR.Length, derS.Length);

            return result;
        }

        private byte[] EncodeDerInteger(byte[] value)
        {
            int start = 0;
            while (start < value.Length - 1 && value[start] == 0) start++;

            bool needsLeadingZero = (value[start] & 0x80) != 0;
            int len = value.Length - start + (needsLeadingZero ? 1 : 0);

            byte[] res = new byte[2 + len];
            res[0] = 0x02; 
            res[1] = (byte)len;
            
            if (needsLeadingZero)
            {
                res[2] = 0x00;
                Array.Copy(value, start, res, 3, value.Length - start);
            }
            else
            {
                Array.Copy(value, start, res, 2, value.Length - start);
            }
            
            return res;
        }
    }
}