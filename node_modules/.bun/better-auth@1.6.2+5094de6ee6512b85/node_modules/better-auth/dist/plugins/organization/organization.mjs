import { getSessionFromCtx } from "../../api/routes/session.mjs";
import { PACKAGE_VERSION } from "../../version.mjs";
import { defaultRoles } from "./access/statement.mjs";
import { ORGANIZATION_ERROR_CODES } from "./error-codes.mjs";
import { getOrgAdapter } from "./adapter.mjs";
import { shimContext } from "../../utils/shim.mjs";
import { orgSessionMiddleware } from "./call.mjs";
import { hasPermission } from "./has-permission.mjs";
import { createOrgRole, deleteOrgRole, getOrgRole, listOrgRoles, updateOrgRole } from "./routes/crud-access-control.mjs";
import { acceptInvitation, cancelInvitation, createInvitation, getInvitation, listInvitations, listUserInvitations, rejectInvitation } from "./routes/crud-invites.mjs";
import { addMember, getActiveMember, getActiveMemberRole, leaveOrganization, listMembers, removeMember, updateMemberRole } from "./routes/crud-members.mjs";
import { checkOrganizationSlug, createOrganization, deleteOrganization, getFullOrganization, listOrganizations, setActiveOrganization, updateOrganization } from "./routes/crud-org.mjs";
import { addTeamMember, createTeam, listOrganizationTeams, listTeamMembers, listUserTeams, removeTeam, removeTeamMember, setActiveTeam, updateTeam } from "./routes/crud-team.mjs";
import { APIError } from "@better-auth/core/error";
import { createAuthEndpoint } from "@better-auth/core/api";
import * as z from "zod";
//#region src/plugins/organization/organization.ts
function parseRoles(roles) {
	return Array.isArray(roles) ? roles.join(",") : roles;
}
const createHasPermissionBodySchema = z.object({ organizationId: z.string().optional() }).and(z.union([z.object({
	permission: z.record(z.string(), z.array(z.string())),
	permissions: z.undefined()
}), z.object({
	permission: z.undefined(),
	permissions: z.record(z.string(), z.array(z.string()))
})]));
const createHasPermission = (options) => {
	return createAuthEndpoint("/organization/has-permission", {
		method: "POST",
		requireHeaders: true,
		body: createHasPermissionBodySchema,
		use: [orgSessionMiddleware],
		metadata: {
			$Infer: { body: {} },
			openapi: {
				description: "Check if the user has permission",
				requestBody: { content: { "application/json": { schema: {
					type: "object",
					properties: {
						permission: {
							type: "object",
							description: "The permission to check",
							deprecated: true
						},
						permissions: {
							type: "object",
							description: "The permission to check"
						}
					},
					required: ["permissions"]
				} } } },
				responses: { "200": {
					description: "Success",
					content: { "application/json": { schema: {
						type: "object",
						properties: {
							error: { type: "string" },
							success: { type: "boolean" }
						},
						required: ["success"]
					} } }
				} }
			}
		}
	}, async (ctx) => {
		const activeOrganizationId = ctx.body.organizationId || ctx.context.session.session.activeOrganizationId;
		if (!activeOrganizationId) throw APIError.from("BAD_REQUEST", ORGANIZATION_ERROR_CODES.NO_ACTIVE_ORGANIZATION);
		const member = await getOrgAdapter(ctx.context, options).findMemberByOrgId({
			userId: ctx.context.session.user.id,
			organizationId: activeOrganizationId
		});
		if (!member) throw APIError.from("UNAUTHORIZED", ORGANIZATION_ERROR_CODES.USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION);
		const result = await hasPermission({
			role: member.role,
			options,
			permissions: ctx.body.permissions,
			organizationId: activeOrganizationId
		}, ctx);
		return ctx.json({
			error: null,
			success: result
		});
	});
};
function organization(options) {
	const opts = options || {};
	let endpoints = {
		createOrganization: createOrganization(opts),
		updateOrganization: updateOrganization(opts),
		deleteOrganization: deleteOrganization(opts),
		setActiveOrganization: setActiveOrganization(opts),
		getFullOrganization: getFullOrganization(opts),
		listOrganizations: listOrganizations(opts),
		createInvitation: createInvitation(opts),
		cancelInvitation: cancelInvitation(opts),
		acceptInvitation: acceptInvitation(opts),
		getInvitation: getInvitation(opts),
		rejectInvitation: rejectInvitation(opts),
		listInvitations: listInvitations(opts),
		getActiveMember: getActiveMember(opts),
		checkOrganizationSlug: checkOrganizationSlug(opts),
		addMember: addMember(opts),
		removeMember: removeMember(opts),
		updateMemberRole: updateMemberRole(opts),
		leaveOrganization: leaveOrganization(opts),
		listUserInvitations: listUserInvitations(opts),
		listMembers: listMembers(opts),
		getActiveMemberRole: getActiveMemberRole(opts)
	};
	const teamSupport = opts.teams?.enabled;
	const teamEndpoints = {
		createTeam: createTeam(opts),
		listOrganizationTeams: listOrganizationTeams(opts),
		removeTeam: removeTeam(opts),
		updateTeam: updateTeam(opts),
		setActiveTeam: setActiveTeam(opts),
		listUserTeams: listUserTeams(opts),
		listTeamMembers: listTeamMembers(opts),
		addTeamMember: addTeamMember(opts),
		removeTeamMember: removeTeamMember(opts)
	};
	if (teamSupport) endpoints = {
		...endpoints,
		...teamEndpoints
	};
	const dynamicAccessControlEndpoints = {
		createOrgRole: createOrgRole(opts),
		deleteOrgRole: deleteOrgRole(opts),
		listOrgRoles: listOrgRoles(opts),
		getOrgRole: getOrgRole(opts),
		updateOrgRole: updateOrgRole(opts)
	};
	if (opts.dynamicAccessControl?.enabled) endpoints = {
		...endpoints,
		...dynamicAccessControlEndpoints
	};
	const roles = {
		...defaultRoles,
		...opts.roles
	};
	const teamSchema = teamSupport ? {
		team: {
			modelName: opts.schema?.team?.modelName,
			fields: {
				name: {
					type: "string",
					required: true,
					fieldName: opts.schema?.team?.fields?.name
				},
				organizationId: {
					type: "string",
					required: true,
					references: {
						model: "organization",
						field: "id"
					},
					fieldName: opts.schema?.team?.fields?.organizationId,
					index: true
				},
				createdAt: {
					type: "date",
					required: true,
					fieldName: opts.schema?.team?.fields?.createdAt
				},
				updatedAt: {
					type: "date",
					required: false,
					fieldName: opts.schema?.team?.fields?.updatedAt,
					onUpdate: () => /* @__PURE__ */ new Date()
				},
				...opts.schema?.team?.additionalFields || {}
			}
		},
		teamMember: {
			modelName: opts.schema?.teamMember?.modelName,
			fields: {
				teamId: {
					type: "string",
					required: true,
					references: {
						model: "team",
						field: "id"
					},
					fieldName: opts.schema?.teamMember?.fields?.teamId,
					index: true
				},
				userId: {
					type: "string",
					required: true,
					references: {
						model: "user",
						field: "id"
					},
					fieldName: opts.schema?.teamMember?.fields?.userId,
					index: true
				},
				createdAt: {
					type: "date",
					required: false,
					fieldName: opts.schema?.teamMember?.fields?.createdAt
				}
			}
		}
	} : {};
	const organizationRoleSchema = opts.dynamicAccessControl?.enabled ? { organizationRole: {
		fields: {
			organizationId: {
				type: "string",
				required: true,
				references: {
					model: "organization",
					field: "id"
				},
				fieldName: opts.schema?.organizationRole?.fields?.organizationId,
				index: true
			},
			role: {
				type: "string",
				required: true,
				fieldName: opts.schema?.organizationRole?.fields?.role,
				index: true
			},
			permission: {
				type: "string",
				required: true,
				fieldName: opts.schema?.organizationRole?.fields?.permission
			},
			createdAt: {
				type: "date",
				required: true,
				defaultValue: () => /* @__PURE__ */ new Date(),
				fieldName: opts.schema?.organizationRole?.fields?.createdAt
			},
			updatedAt: {
				type: "date",
				required: false,
				fieldName: opts.schema?.organizationRole?.fields?.updatedAt,
				onUpdate: () => /* @__PURE__ */ new Date()
			},
			...opts.schema?.organizationRole?.additionalFields || {}
		},
		modelName: opts.schema?.organizationRole?.modelName
	} } : {};
	const schema = {
		organization: {
			modelName: opts.schema?.organization?.modelName,
			fields: {
				name: {
					type: "string",
					required: true,
					sortable: true,
					fieldName: opts.schema?.organization?.fields?.name
				},
				slug: {
					type: "string",
					required: true,
					unique: true,
					sortable: true,
					fieldName: opts.schema?.organization?.fields?.slug,
					index: true
				},
				logo: {
					type: "string",
					required: false,
					fieldName: opts.schema?.organization?.fields?.logo
				},
				createdAt: {
					type: "date",
					required: true,
					fieldName: opts.schema?.organization?.fields?.createdAt
				},
				metadata: {
					type: "string",
					required: false,
					fieldName: opts.schema?.organization?.fields?.metadata
				},
				...opts.schema?.organization?.additionalFields || {}
			}
		},
		...organizationRoleSchema,
		...teamSchema,
		member: {
			modelName: opts.schema?.member?.modelName,
			fields: {
				organizationId: {
					type: "string",
					required: true,
					references: {
						model: "organization",
						field: "id"
					},
					fieldName: opts.schema?.member?.fields?.organizationId,
					index: true
				},
				userId: {
					type: "string",
					required: true,
					fieldName: opts.schema?.member?.fields?.userId,
					references: {
						model: "user",
						field: "id"
					},
					index: true
				},
				role: {
					type: "string",
					required: true,
					sortable: true,
					defaultValue: "member",
					fieldName: opts.schema?.member?.fields?.role
				},
				createdAt: {
					type: "date",
					required: true,
					fieldName: opts.schema?.member?.fields?.createdAt
				},
				...opts.schema?.member?.additionalFields || {}
			}
		},
		invitation: {
			modelName: opts.schema?.invitation?.modelName,
			fields: {
				organizationId: {
					type: "string",
					required: true,
					references: {
						model: "organization",
						field: "id"
					},
					fieldName: opts.schema?.invitation?.fields?.organizationId,
					index: true
				},
				email: {
					type: "string",
					required: true,
					sortable: true,
					fieldName: opts.schema?.invitation?.fields?.email,
					index: true
				},
				role: {
					type: "string",
					required: false,
					sortable: true,
					fieldName: opts.schema?.invitation?.fields?.role
				},
				...teamSupport ? { teamId: {
					type: "string",
					required: false,
					sortable: true,
					fieldName: opts.schema?.invitation?.fields?.teamId
				} } : {},
				status: {
					type: "string",
					required: true,
					sortable: true,
					defaultValue: "pending",
					fieldName: opts.schema?.invitation?.fields?.status
				},
				expiresAt: {
					type: "date",
					required: true,
					fieldName: opts.schema?.invitation?.fields?.expiresAt
				},
				createdAt: {
					type: "date",
					required: true,
					fieldName: opts.schema?.invitation?.fields?.createdAt,
					defaultValue: () => /* @__PURE__ */ new Date()
				},
				inviterId: {
					type: "string",
					references: {
						model: "user",
						field: "id"
					},
					fieldName: opts.schema?.invitation?.fields?.inviterId,
					required: true
				},
				...opts.schema?.invitation?.additionalFields || {}
			}
		}
	};
	return {
		id: "organization",
		version: PACKAGE_VERSION,
		endpoints: {
			...shimContext(endpoints, {
				orgOptions: opts,
				roles,
				getSession: async (context) => {
					return await getSessionFromCtx(context);
				}
			}),
			hasPermission: createHasPermission(opts)
		},
		schema: {
			...schema,
			session: { fields: {
				activeOrganizationId: {
					type: "string",
					required: false,
					fieldName: opts.schema?.session?.fields?.activeOrganizationId
				},
				...teamSupport ? { activeTeamId: {
					type: "string",
					required: false,
					fieldName: opts.schema?.session?.fields?.activeTeamId
				} } : {}
			} }
		},
		$Infer: {
			Organization: {},
			Invitation: {},
			Member: {},
			Team: teamSupport ? {} : {},
			TeamMember: teamSupport ? {} : {},
			ActiveOrganization: {}
		},
		$ERROR_CODES: ORGANIZATION_ERROR_CODES,
		options: opts
	};
}
//#endregion
export { organization, parseRoles };
