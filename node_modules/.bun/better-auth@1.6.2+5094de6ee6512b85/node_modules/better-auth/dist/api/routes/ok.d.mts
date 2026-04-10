import * as better_call0 from "better-call";

//#region src/api/routes/ok.d.ts
declare const ok: better_call0.StrictEndpoint<"/ok", {
  method: "GET";
  metadata: {
    openapi: {
      description: string;
      responses: {
        "200": {
          description: string;
          content: {
            "application/json": {
              schema: {
                type: "object";
                properties: {
                  ok: {
                    type: string;
                    description: string;
                  };
                };
                required: string[];
              };
            };
          };
        };
      };
    };
    scope: "server";
  };
}, {
  ok: boolean;
}>;
//#endregion
export { ok };