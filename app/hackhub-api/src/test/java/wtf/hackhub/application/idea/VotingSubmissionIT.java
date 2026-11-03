package wtf.hackhub.application.idea;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.test.context.support.WithMockUser;
import wtf.hackhub.support.PostgresIntegrationTest;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@WithMockUser(roles = "ADMIN")
class VotingSubmissionIT extends PostgresIntegrationTest {
	@Autowired
	VoteIdeaUseCase votes;

	UUID participant(String org) {
		String name = "votingfixture" + UUID.randomUUID().toString().replace("-", "");
		UUID id = UUID.fromString(insertProfile(name + "@fixture.test", name, "participant"));
		jdbc.update("INSERT INTO voting_participants(personnel_number,organizational_unit,display_name,normalized_name) VALUES (?,?,?,?)",
				id.toString(), org, name, name);
		return id;
	}

	UUID award(UUID owner) {
		return jdbc.queryForObject("INSERT INTO hackathons(title,description,start_date,end_date,created_by,registration_key,allowed_participants) VALUES ('Voting test','Evidence',now(),now()+interval '1 day',?,gen_random_uuid()::text,100) RETURNING id", UUID.class, owner);
	}

	UUID idea(UUID award, UUID owner) {
		return jdbc.queryForObject("INSERT INTO ideas(title,description,hackathon_id,created_by,category) VALUES ('Case','Evidence',?,?,'Customer Values') RETURNING id", UUID.class, award, owner);
	}

	@Test
	void failed_batch_rolls_back_every_vote_and_counter() {
		UUID voter = participant("BD/DPA-SRE3");
		UUID award = award(voter);
		List<UUID> ids = List.of(idea(award, voter), idea(award, voter), idea(award, voter));
		assertThatThrownBy(() -> votes.submit(ids, voter))
				.isInstanceOf(VoteIdeaUseCase.OwnDepartmentVoteLimitExceededException.class);
		assertThat(jdbc.queryForObject("SELECT count(*) FROM idea_votes WHERE user_id=?", Integer.class, voter)).isZero();
		assertThat(jdbc.queryForObject("SELECT sum(votes) FROM ideas WHERE hackathon_id=?", Integer.class, award)).isZero();
	}

	@Test
	void submitted_records_persist_and_deletion_preserves_other_voters() {
		UUID voter = participant("BD/DPA-SRE3"), other = participant("BD/BA-AP");
		UUID award = award(voter), first = idea(award, voter), second = idea(award, other);
		votes.submit(List.of(first, second), voter);
		votes.submit(List.of(first, second), voter);
		assertThat(jdbc.queryForObject("SELECT count(*) FROM idea_votes WHERE user_id=?", Integer.class, voter)).isEqualTo(2);
		jdbc.update("INSERT INTO idea_votes(idea_id,user_id) VALUES (?,?)", first, other);
		votes.deleteRecord(first, voter);
		votes.deleteRecord(first, voter);
		assertThat(jdbc.queryForObject("SELECT count(*) FROM idea_votes WHERE user_id=? AND idea_id=?", Integer.class, voter, first)).isZero();
		assertThat(jdbc.queryForObject("SELECT count(*) FROM idea_votes WHERE user_id=? AND idea_id=?", Integer.class, other, first)).isOne();
		assertThat(jdbc.queryForObject("SELECT votes FROM ideas WHERE id=?", Integer.class, first)).isOne();
		votes.submit(List.of(first), voter);
		assertThat(jdbc.queryForObject("SELECT count(*) FROM idea_votes WHERE user_id=?", Integer.class, voter)).isEqualTo(2);
	}
 UUID teamIdea(UUID award, UUID owner) {
  UUID team = jdbc.queryForObject("INSERT INTO teams(name,description,hackathon_id,created_by) VALUES (gen_random_uuid()::text,'TEST',?,?) RETURNING id", UUID.class, award, owner);
  UUID id = idea(award, owner); jdbc.update("UPDATE ideas SET team_id=? WHERE id=?", team, id); return id;
 }
 @Test void team_three_without_department_constraints_and_individual_separate() {
  UUID voter=participant("BD/DPA-SRE3"), award=award(voter);
  UUID first=teamIdea(award,voter), second=teamIdea(award,voter), third=teamIdea(award,voter), fourth=teamIdea(award,voter);
  votes.submit(List.of(first),voter); votes.submit(List.of(second),voter); votes.submit(List.of(third),voter);
  votes.submit(List.of(first),voter);
  assertThatThrownBy(()->votes.submit(List.of(fourth),voter)).isInstanceOf(VoteIdeaUseCase.VoteLimitExceededException.class);
  votes.submit(List.of(idea(award,voter)),voter); votes.submit(List.of(idea(award,voter)),voter);
  assertThatThrownBy(()->votes.submit(List.of(idea(award,voter)),voter)).isInstanceOf(VoteIdeaUseCase.OwnDepartmentVoteLimitExceededException.class);
  jdbc.update("UPDATE ideas SET category='Collaboration to Win' WHERE id=?", fourth);
  votes.submit(List.of(fourth),voter);
  assertThat(jdbc.queryForObject("SELECT count(*) FROM idea_votes WHERE user_id=?",Integer.class,voter)).isEqualTo(6);
 }
 @Test void concurrent_team_clicks_cannot_exceed_three() throws Exception {
  UUID voter=participant("BD/DPA-SRE3"), award=award(voter);
  var ids=java.util.stream.IntStream.range(0,5).mapToObj(n->teamIdea(award,voter)).toList();
  try(var pool=java.util.concurrent.Executors.newFixedThreadPool(5)) {
   var start=new java.util.concurrent.CountDownLatch(1);
   var futures=ids.stream().map(id->pool.submit(()->{start.await();try{votes.submit(List.of(id),voter);return true;}catch(VoteIdeaUseCase.VoteLimitExceededException ex){return false;}})).toList();
   start.countDown();int ok=0;for(var f:futures)if(f.get(20,java.util.concurrent.TimeUnit.SECONDS))ok++;
   assertThat(ok).isEqualTo(3);
  }
  assertThat(jdbc.queryForObject("SELECT count(*) FROM idea_votes WHERE user_id=?",Integer.class,voter)).isEqualTo(3);
 }

}
