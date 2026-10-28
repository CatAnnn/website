package wtf.hackhub.application.idea;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.AuthorityUtils;
import org.springframework.security.core.context.SecurityContextHolder;
import wtf.hackhub.domain.Idea;
import wtf.hackhub.support.PostgresIntegrationTest;
import wtf.hackhub.infrastructure.security.JwtProvider;
import wtf.hackhub.infrastructure.persistence.auth.ProfileRepository;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.IntConsumer;

import static org.assertj.core.api.Assertions.assertThat;

/** Real PostgreSQL transactions; never runs against an application database. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
		"management.server.port=0", "spring.config.location=file:src/main/resources/application.yml,classpath:/application.yml"})
class ConcurrentSubmissionIT extends PostgresIntegrationTest {
	private static final int CLIENTS = Integer.getInteger("concurrency.clients", 50);

	@Autowired VoteIdeaUseCase votes;
	@Autowired SubmitIdeaUseCase nominations;
	@Autowired JwtProvider jwt;
	@Autowired ProfileRepository profiles;
	@LocalServerPort int port;

	private UUID participant() {
		String name = "concurrent" + UUID.randomUUID().toString().replace("-", "");
		UUID id = UUID.fromString(insertProfile(name + "@fixture.test", name, "manager"));
		jdbc.update("INSERT INTO voting_participants(personnel_number,organizational_unit,display_name,normalized_name) VALUES (?,?,?,?)",
				id.toString(), "BD/DPA-SRE3", name, name);
		return id;
	}

	private UUID award(UUID owner) {
		return jdbc.queryForObject("INSERT INTO hackathons(title,description,start_date,end_date,created_by,registration_key,allowed_participants) VALUES ('Concurrency test','Fixture',now(),now()+interval '1 day',?,gen_random_uuid()::text,100) RETURNING id", UUID.class, owner);
	}

	private void concurrent(String label, int clients, IntConsumer action) throws Exception {
		var ready = new CountDownLatch(clients);
		var start = new CountDownLatch(1);
		List<Long> timings = Collections.synchronizedList(new ArrayList<>());
		try (var executor = Executors.newFixedThreadPool(clients)) {
			var futures = new ArrayList<java.util.concurrent.Future<?>>();
			for (int i = 0; i < clients; i++) {
				final int index = i;
				futures.add(executor.submit(() -> {
					ready.countDown();
					try {
						if (!start.await(10, TimeUnit.SECONDS)) throw new AssertionError("Start timeout");
						SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(
								"fixture", "unused", AuthorityUtils.createAuthorityList("ROLE_ADMIN")));
						long began = System.nanoTime();
						action.accept(index);
						timings.add(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - began));
					} catch (InterruptedException ex) {
						Thread.currentThread().interrupt();
						throw new AssertionError(ex);
					} finally {
						SecurityContextHolder.clearContext();
					}
				}));
			}
			assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
			start.countDown();
			for (var future : futures) future.get(30, TimeUnit.SECONDS);
		}
		Collections.sort(timings);
		assertThat(timings).hasSize(clients);
		System.out.printf("CONCURRENCY %s clients=%d p50_ms=%d p95_ms=%d max_ms=%d%n", label, clients,
				timings.get(clients / 2), timings.get((int) Math.ceil(clients * .95) - 1), timings.get(clients - 1));
	}

	@Test
	void concurrent_voters_submit_and_retry_the_same_ballot_without_losing_or_duplicating_votes() throws Exception {
		var voters = new ArrayList<UUID>();
		for (int i = 0; i < CLIENTS; i++) voters.add(participant());
		UUID award = award(voters.getFirst());
		UUID first = jdbc.queryForObject("INSERT INTO ideas(title,description,hackathon_id,created_by,category) VALUES ('First','Fixture',?,?,'Customer Values') RETURNING id", UUID.class, award, voters.getFirst());
		UUID second = jdbc.queryForObject("INSERT INTO ideas(title,description,hackathon_id,created_by,category) VALUES ('Second','Fixture',?,?,'Customer Values') RETURNING id", UUID.class, award, voters.getFirst());
		concurrent("popular-ballot", CLIENTS, i -> votes.submit(List.of(first, second), voters.get(i)));
		concurrent("retry-ballot", CLIENTS, i -> votes.submit(List.of(second, first), voters.get(i)));
		assertThat(jdbc.queryForObject("SELECT count(*) FROM idea_votes", Integer.class)).isEqualTo(CLIENTS * 2);
		assertThat(jdbc.queryForObject("SELECT votes FROM ideas WHERE id=?", Integer.class, first)).isEqualTo(CLIENTS);
		assertThat(jdbc.queryForObject("SELECT votes FROM ideas WHERE id=?", Integer.class, second)).isEqualTo(CLIENTS);
	}

	@Test
	void concurrent_managers_submit_independent_nominations_without_a_global_queue() throws Exception {
		var managers = new ArrayList<UUID>();
		for (int i = 0; i < CLIENTS; i++) managers.add(participant());
		UUID award = award(managers.getFirst());
		concurrent("new-nomination", CLIENTS, i -> nominations.executeNomination("Nomination " + i, "Fixture", award,
				null, managers.get(i), "Customer Values", List.of(), Idea.Status.SUBMITTED, null, null, null));
		assertThat(jdbc.queryForObject("SELECT count(*) FROM ideas WHERE hackathon_id=?", Integer.class, award)).isEqualTo(CLIENTS);
	}

	@ParameterizedTest
	@ValueSource(booleans = {false, true})
	void public_http_reads_and_authenticated_submissions_succeed_together(boolean ballot) throws Exception {
		var managers = new ArrayList<UUID>();
		var tokens = new ArrayList<String>();
		for (int i = 0; i < CLIENTS / 2; i++) {
			UUID id = participant();
			managers.add(id);
			tokens.add(jwt.issueAccessToken(profiles.findById(id).orElseThrow()));
		}
		UUID award = award(managers.getFirst());
		jdbc.update("UPDATE hackathons SET visibility='public',status='running' WHERE id=?", award);
		for (int i = 0; i < 100; i++)
			jdbc.update("INSERT INTO ideas(title,description,hackathon_id,created_by,category,status) VALUES ('Published','Fixture',?,?,'Customer Values','submitted')", award, managers.getFirst());
		var targets = jdbc.queryForList("SELECT id FROM ideas WHERE hackathon_id=? ORDER BY id LIMIT 2", UUID.class, award);
		String payload = ballot ? "{\"ideaIds\":[\"" + targets.get(0) + "\",\"" + targets.get(1) + "\"]}"
				: "{\"title\":\"Concurrent HTTP nomination\",\"description\":\"Fixture\",\"category\":\"Customer Values\",\"status\":\"SUBMITTED\"}";
		try (var client = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(5)).build()) {
			concurrent(ballot ? "http-mixed-read-ballot" : "http-mixed-read-nomination", CLIENTS, i -> {
				try {
					String path = i % 2 == 0 ? "/api/v1/public/awards/" + award + "/nominations?size=20"
							: ballot ? "/api/v1/me/votes" : "/api/v1/hackathons/" + award + "/ideas";
					var request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).timeout(Duration.ofSeconds(20));
					if (i % 2 != 0) request.header("Authorization", "Bearer " + tokens.get(i / 2))
							.header("Content-Type", "application/json")
							.POST(HttpRequest.BodyPublishers.ofString(payload));
					var response = client.send(request.build(), HttpResponse.BodyHandlers.ofString());
					assertThat(response.statusCode()).isEqualTo(i % 2 == 0 ? 200 : ballot ? 204 : 201);
					if (i % 2 == 0) {
						var page = new com.fasterxml.jackson.databind.ObjectMapper().readTree(response.body());
						assertThat(page.path("content").size()).isEqualTo(20);
						assertThat(page.path("totalElements").asInt()).isBetween(100, 100 + CLIENTS / 2);
					}
				} catch (Exception ex) {
					throw new AssertionError("HTTP operation failed", ex);
				}
			});
		}
		assertThat(jdbc.queryForObject("SELECT count(*) FROM ideas WHERE hackathon_id=?", Integer.class, award)).isEqualTo(ballot ? 100 : 100 + CLIENTS / 2);
		if (ballot) {
			assertThat(jdbc.queryForObject("SELECT count(*) FROM idea_votes", Integer.class)).isEqualTo(CLIENTS);
			for (var target : targets)
				assertThat(jdbc.queryForObject("SELECT votes FROM ideas WHERE id=?", Integer.class, target)).isEqualTo(CLIENTS / 2);
		}
	}
}
