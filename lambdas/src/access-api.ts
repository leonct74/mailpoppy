import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from "aws-lambda";

/**
 * The Cognito-authorized access API (behind API Gateway). The single audited place
 * that enforces "user X can act on ONLY X's mailbox" from verified JWT claims —
 * security-critical multi-tenant isolation (DESIGN §6). Shared by desktop + mobile.
 *
 * Routes (TODO): GET /messages · GET /messages/{id}/raw · PATCH /messages/{id}/flags
 *               · POST /messages/{id}/move · POST /send
 */
export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  const sub = event.requestContext.authorizer.jwt.claims.sub as string;
  // TODO: map `sub` → the addresses this user owns; scope every S3/DynamoDB/SES
  // operation to those addresses so no user can ever read another's mail.
  return {
    statusCode: 501,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ todo: "access-api not implemented", sub }),
  };
}
