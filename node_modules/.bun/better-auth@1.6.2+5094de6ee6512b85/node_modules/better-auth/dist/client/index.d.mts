import { ExtractPluginField, HasRequiredKeys, InferPluginFieldFromTuple, IsAny, OverrideMerge, Prettify, PrettifyDeep, RequiredKeysOf, StripEmptyObjects, UnionToIntersection } from "../types/helper.mjs";
import { CamelCase, InferCtx, InferRoute, InferRoutes, InferSignUpEmailCtx, InferUserUpdateCtx, MergeRoutes, PathToObject, ProxyRequest } from "./path-to-object.mjs";
import { BetterAuthClientOptions, BetterAuthClientPlugin, ClientAtomListener, ClientStore, InferActions, InferAdditionalFromClient, InferClientAPI, InferErrorCodes, InferSessionFromClient, InferUserFromClient, IsSignal, SessionQueryParams } from "./types.mjs";
import { BroadcastChannel, BroadcastListener, BroadcastMessage, getGlobalBroadcastChannel, kBroadcastChannel } from "./broadcast-channel.mjs";
import { FocusListener, FocusManager, kFocusManager } from "./focus-manager.mjs";
import { OnlineListener, OnlineManager, kOnlineManager } from "./online-manager.mjs";
import { parseJSON } from "./parser.mjs";
import { AuthQueryAtom, useAuthQuery } from "./query.mjs";
import { SessionRefreshOptions, SessionResponse, createSessionRefreshManager } from "./session-refresh.mjs";
import { AuthClient, createAuthClient } from "./vanilla.mjs";
import { AccessControl, ArrayElement, Role, Statements, SubArray, Subset } from "../plugins/access/types.mjs";
import { AuthorizeResponse, createAccessControl, role } from "../plugins/access/access.mjs";
import { OrganizationOptions } from "../plugins/organization/types.mjs";
import { InferInvitation, InferMember, InferOrganization, InferOrganizationRolesFromOption, InferOrganizationZodRolesFromOption, InferTeam, Invitation, InvitationInput, InvitationStatus, Member, MemberInput, Organization, OrganizationInput, OrganizationRole, OrganizationSchema, Team, TeamInput, TeamMember, TeamMemberInput, defaultRolesSchema, invitationSchema, invitationStatus, memberSchema, organizationRoleSchema, organizationSchema, roleSchema, teamMemberSchema, teamSchema } from "../plugins/organization/schema.mjs";
import { getOrgAdapter } from "../plugins/organization/adapter.mjs";
import { hasPermission } from "../plugins/organization/has-permission.mjs";
import { DefaultOrganizationPlugin, DynamicAccessControlEndpoints, OrganizationCreator, OrganizationEndpoints, OrganizationPlugin, TeamEndpoints, organization, parseRoles } from "../plugins/organization/organization.mjs";
import { BetterAuthOptions, BetterAuthPlugin } from "@better-auth/core";
import { DBPrimitive } from "@better-auth/core/db";
export * from "@better-auth/core/db";
export * from "nanostores";
export * from "@better-fetch/fetch";

//#region src/client/index.d.ts
declare const InferPlugin: <T extends BetterAuthPlugin>() => {
  id: "infer-server-plugin";
  version: string;
  $InferServerPlugin: T;
};
declare function InferAuth<O extends {
  options: BetterAuthOptions;
}>(): O["options"];
//#endregion
export { AccessControl, ArrayElement, AuthClient, AuthQueryAtom, AuthorizeResponse, BetterAuthClientOptions, BetterAuthClientPlugin, BroadcastChannel, BroadcastListener, BroadcastMessage, CamelCase, ClientAtomListener, ClientStore, type DBPrimitive, DefaultOrganizationPlugin, DynamicAccessControlEndpoints, ExtractPluginField, type FocusListener, type FocusManager, HasRequiredKeys, InferActions, InferAdditionalFromClient, InferAuth, InferClientAPI, InferCtx, InferErrorCodes, InferInvitation, InferMember, InferOrganization, InferOrganizationRolesFromOption, InferOrganizationZodRolesFromOption, InferPlugin, InferPluginFieldFromTuple, InferRoute, InferRoutes, InferSessionFromClient, InferSignUpEmailCtx, InferTeam, InferUserFromClient, InferUserUpdateCtx, Invitation, InvitationInput, InvitationStatus, IsAny, IsSignal, Member, MemberInput, MergeRoutes, type OnlineListener, type OnlineManager, Organization, OrganizationCreator, OrganizationEndpoints, OrganizationInput, OrganizationOptions, OrganizationPlugin, OrganizationRole, OrganizationSchema, OverrideMerge, PathToObject, Prettify, PrettifyDeep, ProxyRequest, RequiredKeysOf, Role, SessionQueryParams, SessionRefreshOptions, SessionResponse, Statements, StripEmptyObjects, SubArray, Subset, Team, TeamEndpoints, TeamInput, TeamMember, TeamMemberInput, type UnionToIntersection, createAccessControl, createAuthClient, createSessionRefreshManager, defaultRolesSchema, getGlobalBroadcastChannel, getOrgAdapter, hasPermission, invitationSchema, invitationStatus, kBroadcastChannel, kFocusManager, kOnlineManager, memberSchema, organization, organizationRoleSchema, organizationSchema, parseJSON, parseRoles, role, roleSchema, teamMemberSchema, teamSchema, useAuthQuery };