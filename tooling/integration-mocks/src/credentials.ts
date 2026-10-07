/**
 * Credentials the mocks accept. They are demo values for a stand-in server on localhost, not secrets: the
 * seed stores them (sealed) in the demo connections, and tests use them.
 */
export const MOCK_CREDENTIALS = {
  sdp: {
    /** Technician API key (`authtoken` header) of the ServiceDesk Plus (on-premises) stand-in. */
    apiKey: '6F1B5E92-0D3A-4C7E-9B21-5A8E0ISBPDEMO',
  },
  ado: {
    collection: 'DefaultCollection',
    /** Personal access token (Basic auth with any user name). */
    pat: 'isbpdemopat0000000000000000000000000000000000000000',
  },
} as const;
