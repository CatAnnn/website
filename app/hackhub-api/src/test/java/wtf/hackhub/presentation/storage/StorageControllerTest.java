package wtf.hackhub.presentation.storage;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import wtf.hackhub.application.storage.StoragePort;
import wtf.hackhub.application.storage.UploadFileUseCase;
import wtf.hackhub.infrastructure.config.SecurityConfig;
import wtf.hackhub.infrastructure.persistence.idea.IdeaRepository;
import wtf.hackhub.infrastructure.persistence.team.TeamMemberRepository;
import wtf.hackhub.infrastructure.security.*;
import wtf.hackhub.presentation.common.GlobalExceptionHandler;
import wtf.hackhub.support.MockAuthHelper;

import java.util.UUID;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(StorageController.class)
@Import({SecurityConfig.class, JwtAuthFilter.class, GlobalExceptionHandler.class, StorageSecurityService.class})
@TestPropertySource(properties = {"app.cors.allowed-origins=http://localhost:5173",
		"app.minio.buckets.avatars=private-avatars"})
class StorageControllerTest {
	@MockBean
	wtf.hackhub.application.idea.NominationApprovalService approvalService;
	@Autowired
	MockMvc mvc;
	@MockBean
	UploadFileUseCase uploads;
	@MockBean
	StoragePort storage;
	@MockBean
	TeamMemberRepository members;
	@MockBean
	HackathonSecurityService hackathons;
	@MockBean
	IdeaRepository ideas;
	@MockBean
	JwtProvider jwtProvider;
	static final UUID USER = UUID.randomUUID();
	static final UUID OTHER = UUID.randomUUID();

	@Test
	void foreign_avatar_upload_is_rejected_before_upload() throws Exception {
		mvc.perform(multipart("/api/v1/storage/upload/avatars")
				.file(new MockMultipartFile("file", "photo.png", "image/png", new byte[]{1}))
				.param("prefix", "avatars/" + OTHER).with(MockAuthHelper.asParticipant(USER)))
				.andExpect(status().isForbidden());
		verifyNoInteractions(uploads, storage);
	}

	@Test
	void own_avatar_upload_uses_configured_bucket() throws Exception {
		when(uploads.execute(any(), eq("private-avatars"), eq("avatars/" + USER)))
				.thenReturn(new UploadFileUseCase.Result("private-avatars", "key", "url"));
		mvc.perform(multipart("/api/v1/storage/upload/avatars")
				.file(new MockMultipartFile("file", "photo.png", "image/png", new byte[]{1}))
				.param("prefix", "avatars/" + USER).with(MockAuthHelper.asParticipant(USER))).andExpect(status().isOk())
				.andExpect(jsonPath("$.key").value("key"));
	}

	@Test
	void physical_bucket_names_do_not_bypass_authorization() throws Exception {
		for (String bucket : new String[]{"avatars", "hackhub-avatars", "private-avatars"}) {
			mvc.perform(get("/api/v1/storage/url/" + bucket).param("key", "avatars/" + OTHER + "/photo.png")
					.with(MockAuthHelper.asParticipant(USER))).andExpect(status().isForbidden());
		}
		verifyNoInteractions(storage);
	}

	@Test
	void team_file_access_is_rejected_before_signing() throws Exception {
		mvc.perform(get("/api/v1/storage/url/team-files").param("key", "teams/" + OTHER + "/file.pdf")
				.with(MockAuthHelper.asParticipant(USER))).andExpect(status().isForbidden());
		verifyNoInteractions(storage);
	}

	@Test
	void authorized_team_member_can_download() throws Exception {
		when(members.existsByTeamIdAndUserId(OTHER, USER)).thenReturn(true);
		when(storage.presignedDownloadUrl(anyString(), anyString(), anyInt())).thenReturn("signed-url");
		mvc.perform(get("/api/v1/storage/url/team-files").param("key", "teams/" + OTHER + "/file.pdf")
				.with(MockAuthHelper.asParticipant(USER))).andExpect(status().isOk())
				.andExpect(jsonPath("$.url").value("signed-url"));
	}

	@Test
	void anonymous_access_is_rejected_before_storage() throws Exception {
		mvc.perform(get("/api/v1/storage/url/avatars").param("key", "avatars/" + USER + "/photo.png"))
				.andExpect(status().isUnauthorized());
		verifyNoInteractions(storage, uploads);
	}
}
