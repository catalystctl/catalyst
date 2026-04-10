import { getDate } from "../../utils/date.mjs";
import { parseJSON } from "../../client/parser.mjs";
import { getCurrentAdapter } from "@better-auth/core/context";
import { BetterAuthError } from "@better-auth/core/error";
import { filterOutputFields } from "@better-auth/core/utils/db";
//#region src/plugins/organization/adapter.ts
const getOrgAdapter = (context, options) => {
	const baseAdapter = context.adapter;
	const orgAdditionalFields = options?.schema?.organization?.additionalFields;
	const memberAdditionalFields = options?.schema?.member?.additionalFields;
	const invitationAdditionalFields = options?.schema?.invitation?.additionalFields;
	const teamAdditionalFields = options?.schema?.team?.additionalFields;
	return {
		findOrganizationBySlug: async (slug) => {
			return filterOutputFields(await (await getCurrentAdapter(baseAdapter)).findOne({
				model: "organization",
				where: [{
					field: "slug",
					value: slug
				}]
			}), orgAdditionalFields);
		},
		createOrganization: async (data) => {
			const organization = await (await getCurrentAdapter(baseAdapter)).create({
				model: "organization",
				data: {
					...data.organization,
					metadata: data.organization.metadata ? JSON.stringify(data.organization.metadata) : void 0
				},
				forceAllowId: true
			});
			return filterOutputFields({
				...organization,
				metadata: organization.metadata && typeof organization.metadata === "string" ? JSON.parse(organization.metadata) : void 0
			}, orgAdditionalFields);
		},
		findMemberByEmail: async (data) => {
			const adapter = await getCurrentAdapter(baseAdapter);
			const user = await adapter.findOne({
				model: "user",
				where: [{
					field: "email",
					value: data.email.toLowerCase()
				}]
			});
			if (!user) return null;
			const member = await adapter.findOne({
				model: "member",
				where: [{
					field: "organizationId",
					value: data.organizationId
				}, {
					field: "userId",
					value: user.id
				}]
			});
			if (!member) return null;
			return {
				...member,
				user: {
					id: user.id,
					name: user.name,
					email: user.email,
					image: user.image
				}
			};
		},
		listMembers: async (data) => {
			const adapter = await getCurrentAdapter(baseAdapter);
			const members = await Promise.all([adapter.findMany({
				model: "member",
				where: [{
					field: "organizationId",
					value: data.organizationId
				}, ...data.filter?.field ? [{
					field: data.filter?.field,
					value: data.filter?.value,
					...data.filter.operator ? { operator: data.filter.operator } : {}
				}] : []],
				limit: data.limit || (typeof options?.membershipLimit === "number" ? options.membershipLimit : 100) || 100,
				offset: data.offset || 0,
				sortBy: data.sortBy ? {
					field: data.sortBy,
					direction: data.sortOrder || "asc"
				} : void 0
			}), adapter.count({
				model: "member",
				where: [{
					field: "organizationId",
					value: data.organizationId
				}, ...data.filter?.field ? [{
					field: data.filter?.field,
					value: data.filter?.value,
					...data.filter.operator ? { operator: data.filter.operator } : {}
				}] : []]
			})]);
			const users = await adapter.findMany({
				model: "user",
				where: [{
					field: "id",
					value: members[0].map((member) => member.userId),
					operator: "in"
				}]
			});
			return {
				members: members[0].map((member) => {
					const user = users.find((user) => user.id === member.userId);
					if (!user) throw new BetterAuthError("Unexpected error: User not found for member");
					return {
						...member,
						user: {
							id: user.id,
							name: user.name,
							email: user.email,
							image: user.image
						}
					};
				}),
				total: members[1]
			};
		},
		findMemberByOrgId: async (data) => {
			const result = await (await getCurrentAdapter(baseAdapter)).findOne({
				model: "member",
				where: [{
					field: "userId",
					value: data.userId
				}, {
					field: "organizationId",
					value: data.organizationId
				}],
				join: { user: true }
			});
			if (!result || !result.user) return null;
			const { user, ...member } = result;
			return {
				...member,
				user: {
					id: user.id,
					name: user.name,
					email: user.email,
					image: user.image
				}
			};
		},
		findMemberById: async (memberId) => {
			const result = await (await getCurrentAdapter(baseAdapter)).findOne({
				model: "member",
				where: [{
					field: "id",
					value: memberId
				}],
				join: { user: true }
			});
			if (!result) return null;
			const { user, ...member } = result;
			return {
				...member,
				user: {
					id: user.id,
					name: user.name,
					email: user.email,
					image: user.image
				}
			};
		},
		createMember: async (data) => {
			return await (await getCurrentAdapter(baseAdapter)).create({
				model: "member",
				data: {
					...data,
					createdAt: /* @__PURE__ */ new Date()
				}
			});
		},
		updateMember: async (memberId, role) => {
			return await (await getCurrentAdapter(baseAdapter)).update({
				model: "member",
				where: [{
					field: "id",
					value: memberId
				}],
				update: { role }
			});
		},
		deleteMember: async ({ memberId, organizationId, userId: _userId }) => {
			const adapter = await getCurrentAdapter(baseAdapter);
			let userId;
			if (!_userId) {
				const member = await adapter.findOne({
					model: "member",
					where: [{
						field: "id",
						value: memberId
					}]
				});
				if (!member) throw new BetterAuthError("Member not found");
				userId = member.userId;
			} else userId = _userId;
			const member = await adapter.delete({
				model: "member",
				where: [{
					field: "id",
					value: memberId
				}]
			});
			if (options?.teams?.enabled) {
				const teams = await adapter.findMany({
					model: "team",
					where: [{
						field: "organizationId",
						value: organizationId
					}]
				});
				await Promise.all(teams.map((team) => adapter.deleteMany({
					model: "teamMember",
					where: [{
						field: "teamId",
						value: team.id
					}, {
						field: "userId",
						value: userId
					}]
				})));
			}
			return member;
		},
		updateOrganization: async (organizationId, data) => {
			const organization = await (await getCurrentAdapter(baseAdapter)).update({
				model: "organization",
				where: [{
					field: "id",
					value: organizationId
				}],
				update: {
					...data,
					metadata: typeof data.metadata === "object" ? JSON.stringify(data.metadata) : data.metadata
				}
			});
			if (!organization) return null;
			return filterOutputFields({
				...organization,
				metadata: organization.metadata ? parseJSON(organization.metadata) : void 0
			}, orgAdditionalFields);
		},
		deleteOrganization: async (organizationId) => {
			const adapter = await getCurrentAdapter(baseAdapter);
			await adapter.deleteMany({
				model: "member",
				where: [{
					field: "organizationId",
					value: organizationId
				}]
			});
			await adapter.deleteMany({
				model: "invitation",
				where: [{
					field: "organizationId",
					value: organizationId
				}]
			});
			await adapter.delete({
				model: "organization",
				where: [{
					field: "id",
					value: organizationId
				}]
			});
			return organizationId;
		},
		setActiveOrganization: async (sessionToken, organizationId, ctx) => {
			return await context.internalAdapter.updateSession(sessionToken, { activeOrganizationId: organizationId });
		},
		findOrganizationById: async (organizationId) => {
			return filterOutputFields(await (await getCurrentAdapter(baseAdapter)).findOne({
				model: "organization",
				where: [{
					field: "id",
					value: organizationId
				}]
			}), orgAdditionalFields);
		},
		checkMembership: async ({ userId, organizationId }) => {
			return await (await getCurrentAdapter(baseAdapter)).findOne({
				model: "member",
				where: [{
					field: "userId",
					value: userId
				}, {
					field: "organizationId",
					value: organizationId
				}]
			});
		},
		findFullOrganization: async ({ organizationId, isSlug, includeTeams, membersLimit }) => {
			const adapter = await getCurrentAdapter(baseAdapter);
			const result = await adapter.findOne({
				model: "organization",
				where: [{
					field: isSlug ? "slug" : "id",
					value: organizationId
				}],
				join: {
					invitation: true,
					member: membersLimit ? { limit: membersLimit } : true,
					...includeTeams ? { team: true } : {}
				}
			});
			if (!result) return null;
			const { invitation: invitations, member: members, team: teams, ...org } = result;
			const userIds = members.map((member) => member.userId);
			const users = userIds.length > 0 ? await adapter.findMany({
				model: "user",
				where: [{
					field: "id",
					value: userIds,
					operator: "in"
				}],
				limit: (typeof options?.membershipLimit === "number" ? options.membershipLimit : 100) || 100
			}) : [];
			const userMap = new Map(users.map((user) => [user.id, user]));
			const membersWithUsers = members.map((member) => {
				const user = userMap.get(member.userId);
				if (!user) throw new BetterAuthError("Unexpected error: User not found for member");
				return {
					...filterOutputFields(member, memberAdditionalFields),
					user: {
						id: user.id,
						name: user.name,
						email: user.email,
						image: user.image
					}
				};
			});
			const filteredOrg = filterOutputFields(org, orgAdditionalFields);
			const filteredInvitations = invitations.map((inv) => filterOutputFields(inv, invitationAdditionalFields));
			const filteredTeams = teams?.map((team) => filterOutputFields(team, teamAdditionalFields));
			return {
				...filteredOrg,
				invitations: filteredInvitations,
				members: membersWithUsers,
				teams: filteredTeams
			};
		},
		listOrganizations: async (userId) => {
			const result = await (await getCurrentAdapter(baseAdapter)).findMany({
				model: "member",
				where: [{
					field: "userId",
					value: userId
				}],
				join: { organization: true }
			});
			if (!result || result.length === 0) return [];
			return result.map((member) => filterOutputFields(member.organization, orgAdditionalFields));
		},
		createTeam: async (data) => {
			return await (await getCurrentAdapter(baseAdapter)).create({
				model: "team",
				data
			});
		},
		findTeamById: async ({ teamId, organizationId, includeTeamMembers }) => {
			const result = await (await getCurrentAdapter(baseAdapter)).findOne({
				model: "team",
				where: [{
					field: "id",
					value: teamId
				}, ...organizationId ? [{
					field: "organizationId",
					value: organizationId
				}] : []],
				join: { ...includeTeamMembers ? { teamMember: true } : {} }
			});
			if (!result) return null;
			const { teamMember, ...team } = result;
			return {
				...team,
				...includeTeamMembers ? { members: teamMember } : {}
			};
		},
		updateTeam: async (teamId, data) => {
			const adapter = await getCurrentAdapter(baseAdapter);
			if ("id" in data) data.id = void 0;
			return await adapter.update({
				model: "team",
				where: [{
					field: "id",
					value: teamId
				}],
				update: { ...data }
			});
		},
		deleteTeam: async (teamId) => {
			const adapter = await getCurrentAdapter(baseAdapter);
			await adapter.deleteMany({
				model: "teamMember",
				where: [{
					field: "teamId",
					value: teamId
				}]
			});
			return await adapter.delete({
				model: "team",
				where: [{
					field: "id",
					value: teamId
				}]
			});
		},
		listTeams: async (organizationId) => {
			return await (await getCurrentAdapter(baseAdapter)).findMany({
				model: "team",
				where: [{
					field: "organizationId",
					value: organizationId
				}]
			});
		},
		createTeamInvitation: async ({ email, role, teamId, organizationId, inviterId, expiresIn = 1e3 * 60 * 60 * 48 }) => {
			const adapter = await getCurrentAdapter(baseAdapter);
			const expiresAt = getDate(expiresIn);
			return await adapter.create({
				model: "invitation",
				data: {
					email,
					role,
					organizationId,
					teamId,
					inviterId,
					status: "pending",
					expiresAt
				}
			});
		},
		setActiveTeam: async (sessionToken, teamId, ctx) => {
			return await context.internalAdapter.updateSession(sessionToken, { activeTeamId: teamId });
		},
		listTeamMembers: async (data) => {
			return await (await getCurrentAdapter(baseAdapter)).findMany({
				model: "teamMember",
				where: [{
					field: "teamId",
					value: data.teamId
				}]
			});
		},
		countTeamMembers: async (data) => {
			return await (await getCurrentAdapter(baseAdapter)).count({
				model: "teamMember",
				where: [{
					field: "teamId",
					value: data.teamId
				}]
			});
		},
		countMembers: async (data) => {
			return await (await getCurrentAdapter(baseAdapter)).count({
				model: "member",
				where: [{
					field: "organizationId",
					value: data.organizationId
				}]
			});
		},
		listTeamsByUser: async (data) => {
			return (await (await getCurrentAdapter(baseAdapter)).findMany({
				model: "teamMember",
				where: [{
					field: "userId",
					value: data.userId
				}],
				join: { team: true }
			})).map((result) => result.team);
		},
		findTeamMember: async (data) => {
			return await (await getCurrentAdapter(baseAdapter)).findOne({
				model: "teamMember",
				where: [{
					field: "teamId",
					value: data.teamId
				}, {
					field: "userId",
					value: data.userId
				}]
			});
		},
		findOrCreateTeamMember: async (data) => {
			const adapter = await getCurrentAdapter(baseAdapter);
			const member = await adapter.findOne({
				model: "teamMember",
				where: [{
					field: "teamId",
					value: data.teamId
				}, {
					field: "userId",
					value: data.userId
				}]
			});
			if (member) return member;
			return await adapter.create({
				model: "teamMember",
				data: {
					teamId: data.teamId,
					userId: data.userId,
					createdAt: /* @__PURE__ */ new Date()
				}
			});
		},
		removeTeamMember: async (data) => {
			await (await getCurrentAdapter(baseAdapter)).deleteMany({
				model: "teamMember",
				where: [{
					field: "teamId",
					value: data.teamId
				}, {
					field: "userId",
					value: data.userId
				}]
			});
		},
		findInvitationsByTeamId: async (teamId) => {
			return await (await getCurrentAdapter(baseAdapter)).findMany({
				model: "invitation",
				where: [{
					field: "teamId",
					value: teamId
				}]
			});
		},
		listUserInvitations: async (email) => {
			return (await (await getCurrentAdapter(baseAdapter)).findMany({
				model: "invitation",
				where: [{
					field: "email",
					value: email.toLowerCase()
				}],
				join: { organization: true }
			})).filter(Boolean).map(({ organization, ...inv }) => ({
				...inv,
				organizationName: organization?.name
			}));
		},
		createInvitation: async ({ invitation, user }) => {
			const adapter = await getCurrentAdapter(baseAdapter);
			const expiresAt = getDate(options?.invitationExpiresIn || 3600 * 48, "sec");
			return await adapter.create({
				model: "invitation",
				data: {
					status: "pending",
					expiresAt,
					createdAt: /* @__PURE__ */ new Date(),
					inviterId: user.id,
					...invitation,
					teamId: invitation.teamIds.length > 0 ? invitation.teamIds.join(",") : null
				}
			});
		},
		findInvitationById: async (id) => {
			return await (await getCurrentAdapter(baseAdapter)).findOne({
				model: "invitation",
				where: [{
					field: "id",
					value: id
				}]
			});
		},
		findPendingInvitation: async (data) => {
			return (await (await getCurrentAdapter(baseAdapter)).findMany({
				model: "invitation",
				where: [
					{
						field: "email",
						value: data.email.toLowerCase()
					},
					{
						field: "organizationId",
						value: data.organizationId
					},
					{
						field: "status",
						value: "pending"
					}
				]
			})).filter((invite) => new Date(invite.expiresAt) > /* @__PURE__ */ new Date());
		},
		findPendingInvitations: async (data) => {
			return (await (await getCurrentAdapter(baseAdapter)).findMany({
				model: "invitation",
				where: [{
					field: "organizationId",
					value: data.organizationId
				}, {
					field: "status",
					value: "pending"
				}]
			})).filter((invite) => new Date(invite.expiresAt) > /* @__PURE__ */ new Date());
		},
		listInvitations: async (data) => {
			return await (await getCurrentAdapter(baseAdapter)).findMany({
				model: "invitation",
				where: [{
					field: "organizationId",
					value: data.organizationId
				}]
			});
		},
		updateInvitation: async (data) => {
			return await (await getCurrentAdapter(baseAdapter)).update({
				model: "invitation",
				where: [{
					field: "id",
					value: data.invitationId
				}],
				update: { status: data.status }
			});
		}
	};
};
//#endregion
export { getOrgAdapter };
