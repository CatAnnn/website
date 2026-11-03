package wtf.hackhub.application.idea;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.data.domain.PageRequest;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.web.server.ResponseStatusException;
import wtf.hackhub.domain.Idea;
import wtf.hackhub.infrastructure.persistence.idea.IdeaRepository;
import wtf.hackhub.infrastructure.security.StorageSecurityService;
import wtf.hackhub.support.PostgresIntegrationTest;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.*;

class NominationApprovalIT extends PostgresIntegrationTest {
	@Autowired SubmitIdeaUseCase submit;
	@Autowired NominationApprovalService approvals;
	@Autowired NominationApprovalDirectory directory;
	@Autowired IdeaRepository ideas;
	@Autowired GetIdeasUseCase getIdeas;
	@Autowired VoteIdeaUseCase votes;
	@Autowired CommentUseCase comments;
	@Autowired ScoreIdeaUseCase scores;
	@Autowired StorageSecurityService storage;
	UUID employee, hod, outsider, campaign;
	NominationApprovalDirectory.Employee roster;

	@BeforeEach
	void identities() throws Exception {
		try (var input = new ClassPathResource("nomination-roster.json").getInputStream()) {
			List<NominationApprovalDirectory.Employee> rows = new ObjectMapper().readValue(input, new TypeReference<>() { });
			roster = rows.stream().filter(e -> e.email() != null && !e.email().isBlank() && e.hodEmail() != null
					&& !e.email().equalsIgnoreCase(e.hodEmail())).findFirst().orElseThrow();
		}
		employee = UUID.fromString(insertProfile(roster.email(), "Editable employee name", "participant"));
		hod = UUID.fromString(insertProfile(roster.hodEmail(), "Editable HoD name", "participant"));
		outsider = UUID.fromString(insertProfile("outsider@example.invalid", roster.nominatingHead(), "participant"));
		bind(employee, roster.email());
		bind(hod, roster.hodEmail());
		campaign = jdbc.queryForObject("INSERT INTO hackathons(title,description,start_date,end_date,registration_key,allowed_participants,created_by,status,visibility) VALUES ('Approval test','Details',now(),now() + interval '30 days','approval-test',1000,?,'running','public') RETURNING id", UUID.class, employee);
	}
	void bind(UUID profile, String email) {
		jdbc.update("INSERT INTO sso_identities(tenant_id,object_id,profile_id,verified_email) VALUES (?,?,?,?)", UUID.randomUUID(), UUID.randomUUID(), profile, email);
	}
	Idea nomination(String title) {
		return submit.executeNomination(title, "Actual employee evidence", campaign, null, employee, "Customer Values", List.of(),
				Idea.Status.COMPLETED, null, null, "[{\"type\":\"nomination\",\"nomineeUserId\":\"" + employee
				+ "\",\"name\":\"Forged name\",\"nominatingHead\":\"Forged HoD\"},{\"type\":\"screenshot\",\"storageKey\":\"nominations/"
				+ campaign + "/" + employee + "/photo.png\"}]");
	}
	NominationApprovalService.Selection selection(Idea idea) {
		return new NominationApprovalService.Selection(idea.getId(), idea.getApprovalVersion());
	}
	UUID team(UUID creator) {
		UUID id = jdbc.queryForObject("INSERT INTO teams(name,description,hackathon_id,created_by) VALUES (?,?,?,?) RETURNING id",
				UUID.class, "Team " + UUID.randomUUID(), "Test-only team", campaign, creator);
		jdbc.update("INSERT INTO team_members(team_id,user_id,role) VALUES (?,?,'leader')", id, creator);
		return id;
	}
	String teamMetadata(UUID captain) {
		var items = new ObjectMapper().createArrayNode();
		items.addObject().put("type", "nomination").put("nominationType", "team")
				.put("nomineeUserId", captain.toString()).put("name", "Forged name")
				.put("nominatorName", "Forged nominator").put("employeeEmail", "forged@example.invalid")
				.put("nomineeOrgCode", "Forged department").put("nominatingHead", "Forged HoD")
				.put("projectName", "Test-only team project").put("coreTeamMembers", "Member One;Member Two")
				.put("achievementSummary", "Test-only measured outcome")
				.put("teamAchievementImpact", "Test-only financial impact")
				.put("cultureDemonstration", "Test-only collaboration evidence");
		items.addObject().put("type", "screenshot").put("storageKey", "nominations/" + campaign + "/" + captain + "/team.png");
		items.addObject().put("type", "document").put("storageKey", "nominations/" + campaign + "/" + captain + "/evidence.pdf");
		return items.toString();
	}
	Idea submitTeam(UUID teamId, UUID captain, String metadata) {
		return submit.executeNomination("Forged title", "Forged description", campaign, teamId, captain,
				"Customer Values", List.of(), Idea.Status.COMPLETED, null, null, metadata);
	}
	@org.junit.jupiter.params.ParameterizedTest
	@org.junit.jupiter.params.provider.ValueSource(strings = {"participant", "manager", "admin"})
	void team_captain_of_every_role_requires_hod_and_retains_actual_evidence(String role) throws Exception {
		jdbc.update("UPDATE profiles SET role=? WHERE id=?", role, employee);
		UUID teamId = team(employee);
		Idea idea = submitTeam(teamId, employee, teamMetadata(employee));
		assertThat(idea.getApprovalStatus()).isEqualTo("pending");
		assertThat(idea.getStatus()).isEqualTo(Idea.Status.SUBMITTED);
		assertThat(idea.getTitle()).isEqualTo("Test-only team project");
		assertThat(idea.getDescription()).contains("Test-only measured outcome", "Test-only financial impact", "Test-only collaboration evidence")
				.doesNotContain("Forged");
		var metadata = new ObjectMapper().readTree(idea.getProjectAttachments()).get(0);
		assertThat(metadata.path("name").asText()).isEqualTo("Test-only team project");
		assertThat(metadata.path("nominatorName").asText()).isEqualTo(roster.name());
		assertThat(metadata.path("employeeEmail").asText()).isEqualTo(roster.email());
		assertThat(metadata.path("nomineeUserId").asText()).isEqualTo(employee.toString());
		assertThat(idea.getProjectAttachments()).doesNotContain("Forged");
		assertThat(approvals.assigned(hod)).extracting(Idea::getId).containsExactly(idea.getId());
		assertThat(getIdeas.listByHackathon(campaign, PageRequest.of(0, 10))).isEmpty();
		Idea rejected = approvals.decide(hod, List.of(selection(idea)), "rejected", "Add financial evidence").getFirst();
		String revised = teamMetadata(employee).replace("Test-only financial impact", "Updated financial evidence");
		Idea updated = submit.update(idea.getId(), employee, "Forged", "Forged", "Customer Values", List.of(),
				Idea.Status.COMPLETED, null, null, revised, rejected.getApprovalVersion());
		assertThat(updated.getTeamId()).isEqualTo(teamId);
		assertThat(updated.getDescription()).contains("Updated financial evidence");
		assertThat(updated.getApprovalStatus()).isEqualTo("pending");
		approvals.decide(hod, List.of(selection(updated)), "approved", "");
		assertThat(getIdeas.listByHackathon(campaign, PageRequest.of(0, 10))).hasSize(1);
	}
	@Test
	void team_members_noncreator_leaders_and_admins_cannot_submit_or_edit_captain_content() {
		UUID teamId = team(employee);
		jdbc.update("INSERT INTO team_members(team_id,user_id,role) VALUES (?,?,'member')", teamId, outsider);
		assertThatThrownBy(() -> submitTeam(teamId, outsider, teamMetadata(outsider)))
				.isInstanceOf(SubmitIdeaUseCase.IdeaAccessDeniedException.class);
		jdbc.update("UPDATE team_members SET role='leader' WHERE team_id=? AND user_id=?", teamId, outsider);
		jdbc.update("UPDATE profiles SET role='admin' WHERE id=?", outsider);
		assertThatThrownBy(() -> submitTeam(teamId, outsider, teamMetadata(outsider)))
				.isInstanceOf(SubmitIdeaUseCase.IdeaAccessDeniedException.class);
		Idea own = submitTeam(teamId, employee, teamMetadata(employee));
		assertThatThrownBy(() -> submit.update(own.getId(), outsider, "Forged", "Forged", "Customer Values", List.of(), null,
				null, null, teamMetadata(outsider), own.getApprovalVersion()))
				.isInstanceOf(SubmitIdeaUseCase.IdeaAccessDeniedException.class);
		jdbc.update("UPDATE team_members SET role='member' WHERE team_id=? AND user_id=?", teamId, employee);
		assertThatThrownBy(() -> submitTeam(teamId, employee, teamMetadata(employee)))
				.isInstanceOf(SubmitIdeaUseCase.IdeaAccessDeniedException.class);
		assertThatThrownBy(() -> submit.update(own.getId(), employee, "Forged", "Forged", "Customer Values", List.of(), null,
				null, null, teamMetadata(employee), own.getApprovalVersion()))
				.isInstanceOf(SubmitIdeaUseCase.IdeaAccessDeniedException.class);
	}
	@Test
	void team_validation_rejects_missing_fields_overlong_summary_foreign_uploads_and_type_changes() throws Exception {
		UUID teamId = team(employee);
		String valid = teamMetadata(employee);
		for (String field : List.of("projectName", "coreTeamMembers", "achievementSummary", "teamAchievementImpact", "cultureDemonstration")) {
			var items = new ObjectMapper().readTree(valid);
			((com.fasterxml.jackson.databind.node.ObjectNode) items.get(0)).remove(field);
			assertThatThrownBy(() -> submitTeam(teamId, employee, items.toString()))
					.isInstanceOf(IllegalArgumentException.class).hasMessageContaining(field);
		}
		assertThatThrownBy(() -> submitTeam(teamId, employee, valid.replace("Test-only measured outcome", "word ".repeat(201))))
				.isInstanceOf(IllegalArgumentException.class).hasMessageContaining("200 words");
		assertThatThrownBy(() -> submitTeam(teamId, employee, valid.replace("Member One;Member Two", "Member One;;Member Two")))
				.isInstanceOf(IllegalArgumentException.class).hasMessageContaining("semicolons");
		assertThatThrownBy(() -> submitTeam(teamId, employee, valid.replace("screenshot", "document")))
				.isInstanceOf(IllegalArgumentException.class).hasMessageContaining("Team Photo");
		assertThatThrownBy(() -> submitTeam(teamId, employee, valid.replace("/" + employee + "/", "/" + outsider + "/")))
				.isInstanceOf(IllegalArgumentException.class).hasMessageContaining("own nomination attachments");
		assertThatThrownBy(() -> submitTeam(teamId, employee, valid.replace("team.png", "../team.png")))
				.isInstanceOf(IllegalArgumentException.class).hasMessageContaining("storage");
		Idea own = submitTeam(teamId, employee, valid);
		assertThatThrownBy(() -> submit.update(own.getId(), employee, "Forged", "Forged", "Customer Values", List.of(), null,
				null, null, valid.replace("\"nominationType\":\"team\"", "\"nominationType\":\"individual\""), own.getApprovalVersion()))
				.isInstanceOf(IllegalArgumentException.class).hasMessageContaining("Team nomination details");
		assertThat(ideas.count()).isEqualTo(1);
	}
	@Test
	void team_captain_requires_verified_sso_even_when_admin() {
		UUID teamId = team(employee);
		jdbc.update("UPDATE profiles SET role='admin' WHERE id=?", employee);
		jdbc.update("UPDATE sso_identities SET verified_email=NULL WHERE profile_id=?", employee);
		assertThatThrownBy(() -> submitTeam(teamId, employee, teamMetadata(employee)))
				.isInstanceOf(IllegalArgumentException.class);
		assertThat(ideas.count()).isZero();
	}

	@Test
	void verified_employee_routes_to_hod_and_unpublished_content_is_private() {
		Idea idea = nomination("Real case");
		assertThat(idea.getApprovalStatus()).isEqualTo("pending");
		assertThat(idea.getStatus()).isEqualTo(Idea.Status.SUBMITTED);
		assertThat(idea.getProjectAttachments()).contains(roster.name(), roster.orgUnit()).doesNotContain("Forged");
		assertThat(approvals.mine(employee)).extracting(Idea::getId).containsExactly(idea.getId());
		assertThat(approvals.assigned(hod)).extracting(Idea::getId).containsExactly(idea.getId());
		assertThat(approvals.canRead(idea, employee)).isTrue();
		assertThat(approvals.canRead(idea, hod)).isTrue();
		assertThat(approvals.canRead(idea, outsider)).isFalse();
		assertThat(getIdeas.listByHackathon(campaign, PageRequest.of(0, 10))).isEmpty();
		assertThat(ideas.findByHackathonIdAndStatusNotOrderByCreatedAtDesc(campaign, Idea.Status.DRAFT, PageRequest.of(0, 10))).isEmpty();
		assertThat(ideas.findAllByHackathonId(campaign)).isEmpty();
		assertThatThrownBy(() -> getIdeas.getById(idea.getId())).isInstanceOf(ResponseStatusException.class);
		assertThatThrownBy(() -> votes.execute(idea.getId(), outsider)).isInstanceOf(ResponseStatusException.class);
		assertThatThrownBy(() -> scores.execute(idea.getId(), outsider, UUID.randomUUID(), 5)).isInstanceOf(ResponseStatusException.class);
		assertThatThrownBy(() -> comments.add(idea.getId(), outsider, "Comment")).isInstanceOf(ResponseStatusException.class);
		assertThatThrownBy(() -> comments.listForIdea(idea.getId())).isInstanceOf(ResponseStatusException.class);
		String key = "nominations/" + campaign + "/" + employee + "/photo.png";
		var outsideAuth = new UsernamePasswordAuthenticationToken(outsider, null, List.of(new SimpleGrantedAuthority("ROLE_PARTICIPANT")));
		var hodAuth = new UsernamePasswordAuthenticationToken(hod, null, List.of(new SimpleGrantedAuthority("ROLE_PARTICIPANT")));
		assertThatThrownBy(() -> storage.requireAccess("project-attachments", key, false, outsideAuth))
				.isInstanceOf(org.springframework.security.access.AccessDeniedException.class);
		assertThatCode(() -> storage.requireAccess("project-attachments", key, false, hodAuth)).doesNotThrowAnyException();
		approvals.decide(hod, List.of(selection(idea)), "approved", "");
		assertThat(getIdeas.listByHackathon(campaign, PageRequest.of(0, 10))).hasSize(1);
		assertThat(ideas.findByHackathonIdAndStatusNotOrderByCreatedAtDesc(campaign, Idea.Status.DRAFT, PageRequest.of(0, 10))).hasSize(1);
	}
	@Test
	void batch_is_atomic_and_rejection_resubmits_with_new_version() {
		Idea first = nomination("First"), second = submitTeam(null, employee, teamMetadata(employee));
		assertThatThrownBy(() -> approvals.decide(hod, List.of(selection(first), new NominationApprovalService.Selection(second.getId(), 999)), "approved", ""))
				.isInstanceOf(ResponseStatusException.class);
		assertThat(ideas.findById(first.getId()).orElseThrow().getApprovalStatus()).isEqualTo("pending");
		assertThatThrownBy(() -> approvals.decide(outsider, List.of(selection(first)), "approved", ""))
				.isInstanceOf(ResponseStatusException.class);
		assertThatThrownBy(() -> approvals.decide(hod, List.of(selection(first)), "rejected", ""))
				.isInstanceOf(IllegalArgumentException.class);
		Idea rejected = approvals.decide(hod, List.of(selection(first)), "rejected", "Add evidence").getFirst();
		assertThat(rejected.getApprovalReason()).isEqualTo("Add evidence");
		assertThatThrownBy(() -> submit.update(first.getId(), employee, "Edited", "Real evidence", "Customer Values", List.of(), null, null, null, first.getProjectAttachments(), first.getApprovalVersion()))
				.isInstanceOf(ResponseStatusException.class);
		Idea resubmitted = submit.update(first.getId(), employee, "Edited", "Real evidence", "Customer Values", List.of(), null, null, null, first.getProjectAttachments(), rejected.getApprovalVersion());
		assertThat(resubmitted.getApprovalStatus()).isEqualTo("pending");
		assertThat(resubmitted.getApprovalReason()).isNull();
		assertThat(resubmitted.getApprovalVersion()).isEqualTo(3);
		approvals.decide(hod, List.of(selection(resubmitted), selection(second)), "approved", "");
		assertThat(jdbc.queryForObject("SELECT count(*) FROM nomination_approval_events", Integer.class)).isEqualTo(6);
		assertThatThrownBy(() -> submit.update(first.getId(), employee, "After approval", "Change", "Customer Values", List.of(), null, null, null, first.getProjectAttachments(), 4))
				.isInstanceOf(ResponseStatusException.class);
	}
	@Test
	void direct_team_submission_creates_captain_atomically_and_allows_one_of_each_type() {
		Idea individual = nomination("Individual");
		Idea team = submitTeam(null, employee, teamMetadata(employee));
		assertThat(team.getTeamId()).isNotNull();
		assertThat(jdbc.queryForObject("SELECT name FROM teams WHERE id=?", String.class, team.getTeamId()))
				.isEqualTo("Test-only team project");
		assertThat(jdbc.queryForObject("SELECT role FROM team_members WHERE team_id=? AND user_id=?", String.class,
				team.getTeamId(), employee)).isEqualTo("leader");
		assertThat(approvals.mine(employee)).extracting(Idea::getId).containsExactlyInAnyOrder(individual.getId(), team.getId());
		assertThatThrownBy(() -> submit.executeNomination("Another track", "Evidence", campaign, null, employee,
				"Innovation Breakthrough", List.of(), null, null, null, null))
				.isInstanceOf(ResponseStatusException.class).hasMessageContaining("only one individual");
		assertThatThrownBy(() -> submitTeam(null, employee, teamMetadata(employee)))
				.isInstanceOf(ResponseStatusException.class).hasMessageContaining("only one team");
		assertThat(jdbc.queryForObject("SELECT count(*) FROM teams", Integer.class)).isEqualTo(1);
	}

	@Test
	void direct_team_submission_reuses_only_creator_current_leader_team() {
		UUID original = team(employee);
		Idea submitted = submitTeam(null, employee, teamMetadata(employee));
		assertThat(submitted.getTeamId()).isEqualTo(original);
		assertThat(jdbc.queryForObject("SELECT count(*) FROM teams", Integer.class)).isEqualTo(1);
		jdbc.update("INSERT INTO team_members(team_id,user_id,role) VALUES (?,?,'member')", original, outsider);
		// Use a verified roster identity for the member, but it must not grant captain rights.
		bind(outsider, "cpy8sgh@bosch.com");
		assertThatThrownBy(() -> submitTeam(null, outsider, teamMetadata(outsider)))
				.isInstanceOf(SubmitIdeaUseCase.IdeaAccessDeniedException.class);
	}

	@Test
	void rejected_submission_keeps_original_type_and_track() {
		Idea individual = nomination("Original");
		Idea rejected = approvals.decide(hod, List.of(selection(individual)), "rejected", "Revise evidence").getFirst();
		assertThatThrownBy(() -> submit.update(rejected.getId(), employee, "Edited", "Evidence", "Innovation Breakthrough",
				List.of(), null, null, null, rejected.getProjectAttachments(), rejected.getApprovalVersion()))
				.isInstanceOf(ResponseStatusException.class).hasMessageContaining("category cannot change");
		assertThatThrownBy(() -> submit.update(rejected.getId(), employee, "Edited", "Evidence", "Customer Values",
				List.of(), null, null, null, teamMetadata(employee), rejected.getApprovalVersion()))
				.isInstanceOf(IllegalArgumentException.class).hasMessageContaining("original team");
		assertThatThrownBy(() -> nomination("Duplicate rejected"))
				.isInstanceOf(ResponseStatusException.class).hasMessageContaining("only one individual");
	}

	@org.junit.jupiter.params.ParameterizedTest
	@org.junit.jupiter.params.provider.ValueSource(booleans = {false, true})
	void simultaneous_submissions_create_only_one_nomination_and_no_orphan_team(boolean team) throws Exception {
		var start = new java.util.concurrent.CountDownLatch(1);
		try (var workers = java.util.concurrent.Executors.newFixedThreadPool(2)) {
			java.util.concurrent.Callable<Boolean> attempt = () -> {
				start.await();
				try {
					if (team) submitTeam(null, employee, teamMetadata(employee));
					else nomination("Concurrent individual");
					return true;
				} catch (ResponseStatusException ex) {
					assertThat(ex.getStatusCode().value()).isEqualTo(409);
					return false;
				}
			};
			var first = workers.submit(attempt);
			var second = workers.submit(attempt);
			start.countDown();
			assertThat(List.of(first.get(), second.get())).containsExactlyInAnyOrder(true, false);
		}
		assertThat(ideas.count()).isEqualTo(1);
		assertThat(jdbc.queryForObject("SELECT count(*) FROM teams", Integer.class)).isEqualTo(team ? 1 : 0);
		assertThat(jdbc.queryForObject("SELECT count(*) FROM nomination_approval_events", Integer.class)).isEqualTo(1);
	}

	@Test
	void names_and_local_profile_email_never_grant_approval_permissions() {
		assertThat(approvals.eligibility(outsider).canReview()).isFalse();
		assertThat(approvals.eligibility(outsider).canSubmit()).isFalse();
		jdbc.update("UPDATE profiles SET name=?,email=? WHERE id=?", roster.nominatingHead(), "local-copy@example.invalid", outsider);
		assertThat(directory.reviewerKey(outsider)).isEmpty();
		jdbc.update("UPDATE sso_identities SET verified_email=NULL WHERE profile_id=?", hod);
		assertThat(directory.reviewerKey(hod)).isEmpty();
		assertThatThrownBy(() -> approvals.assigned(hod)).isInstanceOf(ResponseStatusException.class);
	}
	@Test
	void confirmed_roster_emails_resolve_but_missing_verified_email_blocks_submission() throws Exception {
		List<NominationApprovalDirectory.Employee> rows;
		try (var input = new ClassPathResource("nomination-roster.json").getInputStream()) {
			rows = new ObjectMapper().readValue(input, new TypeReference<>() { });
		}
		assertThat(rows).hasSize(563).allSatisfy(row -> {
			assertThat(row.email()).isNotBlank();
			assertThat(row.hodEmail()).isNotBlank();
		});
		assertThat(rows.stream().filter(NominationApprovalDirectory.Employee::allowSelfApproval))
				.hasSize(2);
		UUID confirmedUser = UUID.fromString(insertProfile("confirmed@example.invalid", "Employee", "participant"));
		bind(confirmedUser, "cpy8sgh@bosch.com");
		assertThat(approvals.eligibility(confirmedUser).canSubmit()).isTrue();
		assertThat(directory.requireEmployee(confirmedUser).name()).contains("CHEN Peiyi");
		assertThat(directory.reviewerKey(hod)).contains("vio2kor@bosch.com");
		jdbc.update("UPDATE sso_identities SET verified_email=NULL WHERE profile_id=?", employee);
		assertThat(approvals.eligibility(employee).canSubmit()).isFalse();
		assertThatThrownBy(() -> nomination("Cannot submit")).isInstanceOf(IllegalArgumentException.class);
		assertThat(ideas.count()).isZero();
	}
	@Test
	void only_explicit_na_roster_hod_can_approve_own_submission() throws Exception {
		List<NominationApprovalDirectory.Employee> rows;
		try (var input = new ClassPathResource("nomination-roster.json").getInputStream()) {
			rows = new ObjectMapper().readValue(input, new TypeReference<>() { });
		}
		var selfHead = rows.stream().filter(NominationApprovalDirectory.Employee::allowSelfApproval)
				.findFirst().orElseThrow();
		UUID selfId = UUID.fromString(insertProfile(selfHead.email(), "Editable name", "participant"));
		bind(selfId, selfHead.email());
		assertThat(directory.allowsSelfApproval(selfId)).isTrue();
		assertThat(approvals.eligibility(selfId).canSubmit()).isTrue();
		assertThat(approvals.eligibility(selfId).canReview()).isTrue();
		Idea own = submit.executeNomination("Self HoD case", "Actual evidence", campaign, null, selfId,
				"Customer Values", List.of(), Idea.Status.SUBMITTED, null, null, null);
		assertThat(approvals.assigned(selfId)).extracting(Idea::getId).containsExactly(own.getId());
		assertThat(approvals.decide(selfId, List.of(selection(own)), "approved", "").getFirst().getApprovalStatus())
				.isEqualTo("approved");
		assertThat(directory.allowsSelfApproval(employee)).isFalse();
		assertThat(directory.allowsSelfApproval(hod)).isFalse();
		Idea forged = nomination("Attempted self routing");
		jdbc.update("UPDATE ideas SET created_by=?,approval_head_key=? WHERE id=?", hod, roster.hodEmail().toLowerCase(java.util.Locale.ROOT), forged.getId());
		assertThat(approvals.assigned(hod)).extracting(Idea::getId).doesNotContain(forged.getId());
		assertThatThrownBy(() -> approvals.decide(hod, List.of(selection(forged)), "approved", ""))
				.isInstanceOf(ResponseStatusException.class);
	}
	@Test
	void concurrent_reviewers_cannot_overwrite_a_decision() throws Exception {
		Idea idea = nomination("Concurrent review");
		var start = new java.util.concurrent.CountDownLatch(1);
		try (var workers = java.util.concurrent.Executors.newFixedThreadPool(2)) {
			java.util.concurrent.Callable<Boolean> approve = () -> {
				start.await();
				try {
					approvals.decide(hod, List.of(selection(idea)), "approved", "");
					return true;
				} catch (ResponseStatusException ex) {
					assertThat(ex.getStatusCode().value()).isEqualTo(409);
					return false;
				}
			};
			var first = workers.submit(approve);
			var second = workers.submit(approve);
			start.countDown();
			assertThat(List.of(first.get(), second.get())).containsExactlyInAnyOrder(true, false);
		}
		assertThat(jdbc.queryForObject("SELECT count(*) FROM nomination_approval_events WHERE decision='approved'", Integer.class)).isEqualTo(1);
	}
	@org.junit.jupiter.params.ParameterizedTest
	@org.junit.jupiter.params.provider.ValueSource(strings = {"participant", "manager", "admin"})
	void confirmed_test_hod_can_reject_resubmit_and_approve_own_submission(String role) {
		String email = "fixed-term.Yaolong.ZHANG@cn.bosch.com";
		UUID tester = UUID.fromString(insertProfile(email, "SSO test display name", role));
		jdbc.update("UPDATE profiles SET org_code='TEST-DEPARTMENT' WHERE id=?", tester);
		bind(tester, email);
		assertThat(approvals.eligibility(tester).canSubmit()).isTrue();
		assertThat(approvals.eligibility(tester).canReview()).isTrue();
		assertThat(directory.allowsSelfApproval(tester)).isTrue();
		Idea own = submit.executeNomination("Self review validation", "Test evidence, not an award claim", campaign,
				null, tester, "Collaboration to Win", List.of("test"), Idea.Status.COMPLETED, null, null,
				"[{\"type\":\"nomination\",\"nomineeUserId\":\"" + tester
				+ "\",\"name\":\"Forged name\",\"nomineeOrgCode\":\"Forged department\"}]");
		assertThat(own.getApprovalStatus()).isEqualTo("pending");
		assertThat(own.getProjectAttachments()).contains("SSO test display name", "TEST-DEPARTMENT")
				.doesNotContain("Forged");
		assertThat(approvals.assigned(tester)).extracting(Idea::getId).containsExactly(own.getId());
		assertThat(approvals.assigned(hod)).extracting(Idea::getId).doesNotContain(own.getId());
		assertThat(getIdeas.listByHackathon(campaign, PageRequest.of(0, 10))).isEmpty();
		assertThatThrownBy(() -> approvals.decide(outsider, List.of(selection(own)), "approved", ""))
				.isInstanceOf(ResponseStatusException.class);
		Idea rejected = approvals.decide(tester, List.of(selection(own)), "rejected", "Please revise test evidence").getFirst();
		assertThat(approvals.mine(tester).getFirst().getApprovalReason()).isEqualTo("Please revise test evidence");
		Idea revised = submit.update(rejected.getId(), tester, own.getTitle(), "Revised test evidence", own.getCategory(),
				own.getTags(), null, null, null, own.getProjectAttachments(), rejected.getApprovalVersion());
		assertThat(revised.getApprovalStatus()).isEqualTo("pending");
		assertThat(approvals.assigned(tester).getFirst().getDescription()).isEqualTo("Revised test evidence");
		Idea approved = approvals.decide(tester, List.of(selection(revised)), "approved", "Test reviewed").getFirst();
		assertThat(approvals.mine(tester).getFirst().getApprovalStatus()).isEqualTo("approved");
		assertThat(getIdeas.listByHackathon(campaign, PageRequest.of(0, 10))).hasSize(1);
		assertThatThrownBy(() -> approvals.decide(tester, List.of(selection(approved)), "approved", ""))
				.isInstanceOf(ResponseStatusException.class);
	}
	@Test
	void test_hod_local_email_without_verified_sso_does_not_grant_self_review() {
		UUID local = UUID.fromString(insertProfile("fixed-term.yaolong.zhang@cn.bosch.com", "Local test", "participant"));
		assertThat(approvals.eligibility(local).canSubmit()).isFalse();
		assertThat(approvals.eligibility(local).canReview()).isFalse();
		assertThat(directory.allowsSelfApproval(local)).isFalse();
		bind(local, "someone-else@cn.bosch.com");
		assertThat(directory.allowsSelfApproval(local)).isFalse();
		assertThatThrownBy(() -> approvals.assigned(local)).isInstanceOf(ResponseStatusException.class);
	}
	@Test
	void self_approval_and_repeated_decisions_are_rejected() {
		Idea idea = nomination("One decision");
		assertThatThrownBy(() -> approvals.decide(employee, List.of(selection(idea)), "approved", ""))
				.isInstanceOf(ResponseStatusException.class);
		approvals.decide(hod, List.of(selection(idea)), "approved", "");
		assertThatThrownBy(() -> approvals.decide(hod, List.of(selection(idea)), "rejected", "Change decision"))
				.isInstanceOf(ResponseStatusException.class);
		assertThat(ideas.findById(idea.getId()).orElseThrow().getApprovalStatus()).isEqualTo("approved");
	}
	@Test
	void legacy_nominations_stay_visible() {
		Idea legacy = ideas.saveAndFlush(new Idea("Legacy", "Preserved", campaign, null, employee, "Customer Values"));
		assertThat(legacy.getApprovalStatus()).isNull();
		assertThat(getIdeas.listByHackathon(campaign, PageRequest.of(0, 10))).hasSize(1);
	}
 @Autowired wtf.hackhub.application.judging.SubmitJudgeScoreUseCase judgeScoring;
 @Autowired wtf.hackhub.application.judging.GetJudgeScoresUseCase judgeTotals;
 @Autowired wtf.hackhub.infrastructure.persistence.idea.VotingCriteriaRepository criteriaRepository;
 @Test void verified_roster_hod_scores_without_assignment_using_track_weights() {
  Idea idea=nomination("Scoring test"); approvals.decide(hod,List.of(selection(idea)),"approved",null);
  var criteria=criteriaRepository.saveAll(wtf.hackhub.application.judging.DigitalPioneerCriteria.template(campaign));
  var values=List.of(new wtf.hackhub.application.judging.SubmitJudgeScoreUseCase.CriterionScore(criteria.get(0).getId(),8),new wtf.hackhub.application.judging.SubmitJudgeScoreUseCase.CriterionScore(criteria.get(1).getId(),5),new wtf.hackhub.application.judging.SubmitJudgeScoreUseCase.CriterionScore(criteria.get(2).getId(),9));
  assertThat(jdbc.queryForObject("SELECT count(*) FROM hackathon_judges WHERE user_id=?",Integer.class,hod)).isZero();
  judgeScoring.submitEvaluation(campaign,idea.getId(),hod,values,"Evidence");
  assertThat(judgeTotals.getSummary(campaign).getFirst().panelScore()).isEqualByComparingTo("7.40");
  jdbc.update("UPDATE ideas SET category='Collaboration to Win' WHERE id=?",idea.getId());
  assertThat(judgeTotals.getSummary(campaign).getFirst().panelScore()).isEqualByComparingTo("7.30");
  assertThatThrownBy(()->judgeScoring.submitEvaluation(campaign,idea.getId(),outsider,values,"Forged"))
    .isInstanceOf(wtf.hackhub.application.judging.SubmitJudgeScoreUseCase.NotAJudgeException.class);
  assertThatThrownBy(()->judgeScoring.submitEvaluation(campaign,idea.getId(),hod,values.subList(0,2),"Partial"))
    .isInstanceOf(IllegalArgumentException.class);
  jdbc.update("DELETE FROM sso_identities WHERE profile_id=?",hod);
  assertThatThrownBy(()->judgeScoring.submitEvaluation(campaign,idea.getId(),hod,values,"Unverified email"))
    .isInstanceOf(wtf.hackhub.application.judging.SubmitJudgeScoreUseCase.NotAJudgeException.class);
 }

}
