import * as better_call0 from "better-call";

//#region src/api/routes/sign-out.d.ts
declare const signOut: better_call0.StrictEndpoint<"/sign-out", {
  method: "POST";
  operationId: string;
  requireHeaders: true;
  metadata: {
    openapi: {
      operationId: string;
      description: string;
      responses: {
        "200": {
          description: string;
          content: {
            "application/json": {
              schema: {
                type: "object";
                properties: {
                  success: {
                    type: string;
                  };
                };
              };
            };
          };
        };
      };
    };
  };
}, {
  success: boolean;
}>;
//#endregion
export { signOut };