/**
 * AWS Cognito Identity Provider Integration
 * Wrapped with AWS X-Ray for Telemetry Tracing
 */

const {
  CognitoIdentityProviderClient,
  SignUpCommand,
  ConfirmSignUpCommand,
  InitiateAuthCommand,
  GetUserCommand,
  AuthFlowType
} = require('@aws-sdk/client-cognito-identity-provider');
const crypto = require('crypto');
const AWSXRay = require('aws-xray-sdk');

const region = process.env.AWS_REGION || 'us-east-1';
const userPoolId = process.env.COGNITO_USER_POOL_ID || '';
const clientId = process.env.COGNITO_CLIENT_ID || '';
const clientSecret = process.env.COGNITO_CLIENT_SECRET || '';

// Initialize raw Cognito Client and instrument with AWS X-Ray
const rawCognitoClient = new CognitoIdentityProviderClient({ region });
const cognitoClient = AWSXRay.captureAWSv3Client(rawCognitoClient);

/**
 * Calculate SecretHash if COGNITO_CLIENT_SECRET is configured
 * SecretHash = Base64( HMAC-SHA256( ClientSecret, Username + ClientId ) )
 */
function calculateSecretHash(username) {
  if (!clientSecret) return undefined;
  return crypto
    .createHmac('sha256', clientSecret)
    .update(username + clientId)
    .digest('base64');
}

/**
 * Register a new user in AWS Cognito User Pool
 */
async function signUpUser(username, email, password) {
  if (!clientId) {
    throw new Error('COGNITO_CLIENT_ID is not configured in environment variables.');
  }

  const secretHash = calculateSecretHash(username);

  const command = new SignUpCommand({
    ClientId: clientId,
    Username: username,
    Password: password,
    SecretHash: secretHash,
    UserAttributes: [
      { Name: 'email', Value: email }
    ]
  });

  const response = await cognitoClient.send(command);
  return {
    userSub: response.UserSub,
    isConfirmed: response.UserConfirmed,
    codeDeliveryDetails: response.CodeDeliveryDetails
  };
}

/**
 * Confirm User Signup using email verification code
 */
async function confirmSignUp(username, confirmationCode) {
  if (!clientId) {
    throw new Error('COGNITO_CLIENT_ID is not configured in environment variables.');
  }

  const secretHash = calculateSecretHash(username);

  const command = new ConfirmSignUpCommand({
    ClientId: clientId,
    Username: username,
    ConfirmationCode: confirmationCode,
    SecretHash: secretHash
  });

  await cognitoClient.send(command);
  return { success: true };
}

/**
 * Authenticate User with AWS Cognito (USER_PASSWORD_AUTH Flow)
 */
async function loginUser(username, password) {
  if (!clientId) {
    throw new Error('COGNITO_CLIENT_ID is not configured in environment variables.');
  }

  const secretHash = calculateSecretHash(username);

  const authParameters = {
    USERNAME: username,
    PASSWORD: password
  };

  if (secretHash) {
    authParameters.SECRET_HASH = secretHash;
  }

  const command = new InitiateAuthCommand({
    AuthFlow: AuthFlowType.USER_PASSWORD_AUTH,
    ClientId: clientId,
    AuthParameters: authParameters
  });

  const response = await cognitoClient.send(command);
  const result = response.AuthenticationResult;

  return {
    idToken: result.IdToken,
    accessToken: result.AccessToken,
    refreshToken: result.RefreshToken,
    expiresIn: result.ExpiresIn,
    tokenType: result.TokenType
  };
}

/**
 * Retrieve User Profile Attributes from AWS Cognito using Access Token
 */
async function getUserProfile(accessToken) {
  const command = new GetUserCommand({
    AccessToken: accessToken
  });

  const response = await cognitoClient.send(command);
  const attributes = {};

  if (response.UserAttributes) {
    for (const attr of response.UserAttributes) {
      attributes[attr.Name] = attr.Value;
    }
  }

  return {
    username: response.Username,
    email: attributes.email,
    emailVerified: attributes.email_verified === 'true',
    sub: attributes.sub
  };
}

module.exports = {
  isConfigured: () => Boolean(clientId),
  signUpUser,
  confirmSignUp,
  loginUser,
  getUserProfile
};
