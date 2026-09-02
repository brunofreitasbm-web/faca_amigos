import { rootCertificates } from "node:tls";

/**
 * Cadeia ICP-Brasil servida pela SVRS (NFC-e), em produção e homologação.
 *
 * O Node confia na lista da Mozilla, e a AC Raiz Brasileira NÃO está nela.
 * Sem estes PEMs toda transmissão à SVRS morre com "unable to get local
 * issuer certificate": a nota é montada, assinada e numerada, e só falha no
 * handshake TLS — o que faz o erro parecer problema do certificado A1 do
 * emitente quando na verdade é da cadeia do servidor.
 *
 * Os dois hosts (nfce.svrs.rs.gov.br e nfce-homologacao.svrs.rs.gov.br)
 * apresentam o mesmo caminho: leaf *.svrs.rs.gov.br (PROCERGS) -> AC do
 * SERPRO SSLv1 -> AC Raiz Brasileira v10. O servidor já entrega a
 * intermediária, mas ela vai junto aqui para o handshake não depender disso.
 *
 * Obtidos e conferidos em 2026-09-02:
 *   raiz:   https://acraiz.icpbrasil.gov.br/credenciadas/RAIZ/ICP-Brasilv10.crt
 *   cadeia: openssl s_client -connect nfce.svrs.rs.gov.br:443 -showcerts
 *   prova:  openssl verify -CAfile raiz -untrusted intermediaria leaf -> OK
 *
 * AMBOS EXPIRAM EM 01/07/2032. Renovar antes disso, ou a emissão para.
 */
export const ICP_BRASIL_CA_PEMS: readonly string[] = [
  // Autoridade Certificadora Raiz Brasileira v10
  // Expira em Jul  1 12:00:59 2032 GMT — SHA-256: 6E:0B:FF:06:9A:26:99:4C:15:DE:2C:48:88:CC:54:AF:84:88:2E:54:95:B7:FB:F6:6B:E9:CC:FF:EC:74:89:F6
  `-----BEGIN CERTIFICATE-----
MIIGrDCCBJSgAwIBAgIJANLVi0S/gZNCMA0GCSqGSIb3DQEBDQUAMIGYMQswCQYD
VQQGEwJCUjETMBEGA1UECgwKSUNQLUJyYXNpbDE9MDsGA1UECww0SW5zdGl0dXRv
IE5hY2lvbmFsIGRlIFRlY25vbG9naWEgZGEgSW5mb3JtYWNhbyAtIElUSTE1MDMG
A1UEAwwsQXV0b3JpZGFkZSBDZXJ0aWZpY2Fkb3JhIFJhaXogQnJhc2lsZWlyYSB2
MTAwHhcNMTkwNzAxMTkxNTU5WhcNMzIwNzAxMTIwMDU5WjCBmDELMAkGA1UEBhMC
QlIxEzARBgNVBAoMCklDUC1CcmFzaWwxPTA7BgNVBAsMNEluc3RpdHV0byBOYWNp
b25hbCBkZSBUZWNub2xvZ2lhIGRhIEluZm9ybWFjYW8gLSBJVEkxNTAzBgNVBAMM
LEF1dG9yaWRhZGUgQ2VydGlmaWNhZG9yYSBSYWl6IEJyYXNpbGVpcmEgdjEwMIIC
IjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAk3AxKl1ZtP0pNyjChqO7qNkn
+/sClZeqiV/Kd7KnnbkDbI2y3VWcUG7feCE/deIxot6GH6JXncRG794UZl+4doD0
D0/cEwBd4DvrDSZm0RT40xhmYYOTxZDJxv+coTHdmsT5aNmSkktfjzYX4HQHh/7M
em+kTOpT/3E4K6B7KVs9HkOT7nXx5yU1qYbVWqI0qpJM9mOTSFx8C9HiKcHvLCvt
1ioXKPAmFuHPkayOcXP2MXeb+VRNjWKU4E+L2t5uZPKVx1M/9i1DztlLb4K8OfYg
GaPDUSF1sxnoGk5qZHLleO6KjCpmuQepmgsBvxi2YNO7X2YUwQQx1AXNSolgtkAR
5gt+1WzxhbFUhItQqlhqxgWHefLmiT5T/Ctz/P2v+zSO4efkkIzsi1iwD+ypZvM2
lnIvB24RcSN6jzmCahLPX4CwjwIK6JsSoMVxIhpZHCguUP4LXqP8IWUZ6WgS/4zB
7B9E0EICl2rM1PRy+6ulv+ZOW256e8a0pijUB+hXM1msUq9L92476FAAX8va3sP7
+Uut94+bGHmubcTLImWUPrxNT7QyrvE3FyHicfiHioeFL2oV4cXTLZrEq2wS8R4P
KPdSzNn5Z9e2uMEGYQaSNO+OwvVycpIhOBOqrm12wJ9ZhWKtM5UOo34/o37r5ZBI
TYXAGbhqQDB9mWXwH+0CAwEAAaOB9jCB8zBOBgNVHSAERzBFMEMGBWBMAQEAMDow
OAYIKwYBBQUHAgEWLGh0dHA6Ly9hY3JhaXouaWNwYnJhc2lsLmdvdi5ici9EUENh
Y3JhaXoucGRmMEAGA1UdHwQ5MDcwNaAzoDGGL2h0dHA6Ly9hY3JhaXouaWNwYnJh
c2lsLmdvdi5ici9MQ1JhY3JhaXp2MTAuY3JsMB8GA1UdIwQYMBaAFHTzfv/8n1N6
8Xzrqz6kptoYukVjMB0GA1UdDgQWBBR0837//J9TevF866s+pKbaGLpFYzAPBgNV
HRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBBjANBgkqhkiG9w0BAQ0FAAOCAgEA
eCNhBSuy/Ih/T+1VOtAJju85SrtoE3vET1qXASpmjQllDHG/ph7VFNRAkC+gha+B
CbjoA5oJ/8wwl+Qdp1KGz6nXXFTLx3osU+kjm0srmBf9nyXHPqvFyvBeB0A7sYb7
TmII9GKD20oCxsdkccR/oE/JuTaNnGq0GYZ2aDb5v62uLi21Y6P9UBiTxZqQ4ojW
ET6kXNjlK238jpXv17FR8Sg3VusCvX7Q8eJkavvHHZDeWck2fSA+ycAc2JeL2Z0B
MSxGWpH32WM9J8+6XqCJUXHiWEV0zCE8wDYiYC+047pTxQI/gB/FcU7jvylh98DJ
kQPHd/Tp6Og3ynlDA9n9uBbxYHVRZs9vsZ/7xTFaxRe+zk8dhgKgZ/3RrcMFB570
2t8LFbyuUE/kQVY6rZ0QJ9qMWQ7VPLRwRhiMeU3k8WDJb/tBbOXHBqldTbWyQ+mp
MEDWhbrzE/IED82wAuO23Tb05cYk2xC7+Izef8fSc3XdJDuPSbcDpWukzyCDtSEH
isLiGEtIbYRiPsF3czlQPsnIEVoTTCWxHCH1zYR6zScSv18Qh69qVe2J40K5jZoP
GEOhq/oKhVJQAdvAFW5Odp7mF3Tk9nivjjsctJSxY26LFiV5GRV+07SSse4ti0aO
jO5PLg5SWjfcOtBG2rz02EIvQAmLcb0kGBtfdj0lW/w=
-----END CERTIFICATE-----
`,
  // Autoridade Certificadora do SERPRO SSLv1
  // Expira em Jul  1 12:00:59 2032 GMT — SHA-256: 08:FC:94:2D:51:76:E5:68:AC:BE:F9:C5:95:F3:6A:20:DE:6A:CF:9E:A3:0C:6F:5F:CE:DD:48:21:6E:D5:B0:70
  `-----BEGIN CERTIFICATE-----
MIIHAjCCBOqgAwIBAgIJAJVIeKgiEmNTMA0GCSqGSIb3DQEBDQUAMIGYMQswCQYD
VQQGEwJCUjETMBEGA1UECgwKSUNQLUJyYXNpbDE9MDsGA1UECww0SW5zdGl0dXRv
IE5hY2lvbmFsIGRlIFRlY25vbG9naWEgZGEgSW5mb3JtYWNhbyAtIElUSTE1MDMG
A1UEAwwsQXV0b3JpZGFkZSBDZXJ0aWZpY2Fkb3JhIFJhaXogQnJhc2lsZWlyYSB2
MTAwHhcNMjAwMzEyMTkzMTQyWhcNMzIwNzAxMTIwMDU5WjCBjDELMAkGA1UEBhMC
QlIxEzARBgNVBAoMCklDUC1CcmFzaWwxNTAzBgNVBAsMLEF1dG9yaWRhZGUgQ2Vy
dGlmaWNhZG9yYSBSYWl6IEJyYXNpbGVpcmEgdjEwMTEwLwYDVQQDDChBdXRvcmlk
YWRlIENlcnRpZmljYWRvcmEgZG8gU0VSUFJPIFNTTHYxMIICIjANBgkqhkiG9w0B
AQEFAAOCAg8AMIICCgKCAgEA61jQVBX27GVzyZkJuyrEezqjBGdLSJDFRyGdwxbm
8Ntr0AA8blhDaN5ASDOjqDESMA7xF38znfkZWBMLxJ3Ob0271W6G9bqgTwp/svhZ
s91UcbZW6sB7gyxzMTGWLxcFMeBrurM0QpMVsp8hDH5Suv5rfP0YB9brz60k104u
HG625rAcbRKHn7XsWJ1ZUQcwRzx1g0L1NlUKpsk0+eOAxTcVSVRTO33k+n6Gve83
4MXMiG6Orved4isnEvQnl4AecCXOuUuM3vXZ+kdJGTpNy1HOy0coFdKCJSSCxU/y
TbTiAiRJTc8rbvor3I7k7wR4ZDR8alDbW/Sbw1JEMtbQqMOXEOV7iEUIub0/uNT2
g0oM4pu8DAxhIwy2YQCpjfCbzYu2bf1nabuOEQ2B4mFt/zgoxa5FLsM+0IjpCi8u
z9RqLvYFo9pIy5BTi7JMkVfbgqcOv7vkQf3xF7sODdInCVRIbB0R6xpHm+bpitx9
t5ip+Sf24QFlKbjy0gwVAnaEyf/iQF+t8qgcFBO65kyfH/2vs6iYg5TNhFKtjpqQ
iTyI7YkRkfTbLFdcgZbiRUUs5TFi0BkS4PAWupO1GgV9sJdk9gm3Z+KNZDgoAnu7
Cvhq1JXt6t7qO96WzBx9q9hi7T6eld1VFrV5Ya5kxM9Lgh+XcBDwfnDLI1Yoozbd
MbkCAwEAAaOCAVcwggFTMIGtBgNVHSAEgaUwgaIwTwYGYEwBAYEJMEUwQwYIKwYB
BQUHAgEWN2h0dHBzOi8vcmVwb3NpdG9yaW8uc2VycHJvLmdvdi5ici9kb2NzL2Rw
Y3NlcnByb3NzbC5wZGYwTwYGYEwBAgFpMEUwQwYIKwYBBQUHAgEWN2h0dHBzOi8v
cmVwb3NpdG9yaW8uc2VycHJvLmdvdi5ici9kb2NzL2RwY3NlcnByb3NzbC5wZGYw
QAYDVR0fBDkwNzA1oDOgMYYvaHR0cDovL2FjcmFpei5pY3BicmFzaWwuZ292LmJy
L0xDUmFjcmFpenYxMC5jcmwwHwYDVR0jBBgwFoAUdPN+//yfU3rxfOurPqSm2hi6
RWMwHQYDVR0OBBYEFK0WT0vxDL7CiqKFGNcNRiWTIuPNMA8GA1UdEwEB/wQFMAMB
Af8wDgYDVR0PAQH/BAQDAgGGMA0GCSqGSIb3DQEBDQUAA4ICAQCDvWkOYakalAHB
3ZcifI9yLyuTtjR8eYXlfDesYr7zMFVlmduVghCgueBMZxmht9BpLq9/ceBWu1q8
sKge5oNNyySPmBJFe+CLjtB7Z1Ljk0Q/7A59lMCDZajojJlSEnH6pdhxA1JD58E0
dGsom3SufuBWxdNfgsvpQNXDoKp48VlkyL4DKFCdJExtzuR5IlcQbB1FrmB5m2zo
GG6j7UdoevmikIv01la+8kyn7CF5aNubRE0cfwxulik5LNM1uLIwfUVwYbbQiB8z
baLUOS2lU/pYr+seLQ7VBPHps/guGB9hKei/Df49KWjDVplu3+AuZhBHqiK533VJ
f9Uwv3Rvx8FCobT54OCrAVfnFs8F6sM3dPh1u7AbW3Ddpeo4oBH5kBA0feLvLk7v
mOnOq64oPMMoj+g6x0B0v7tGqOrNBZK486MaU/uaJi+omx+Le9EfyIz39BbRYGdV
JvO/9P8vn5XnNXsmqziw08ENLjHcrro48tRm3YX0/BUgoitjMUqyzlKTgQ8UOpfi
XeJzqvxvUMO/HgZK9aknN3WQXWXxIFG01OHsEOTd2Nddqbrth5qmZE+1IxwEH+ys
QQzlV0pnPL5K0bRuPCqvH4Jr0CmwV2PqD6dkjI/Sy77XDkTP8adAuYjIEynBoQ0b
tqY/0rJPT3dztepWAwRHhKbvO1yYkA==
-----END CERTIFICATE-----
`,
];

export function montarCaBundle(): string[] {
  return [...rootCertificates, ...ICP_BRASIL_CA_PEMS];
}
