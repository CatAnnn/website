package wtf.hackhub.infrastructure.persistence.idea;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import wtf.hackhub.domain.Idea;

import java.util.List;
import java.util.UUID;

public interface IdeaRepository extends JpaRepository<Idea, UUID> {
	@Query("select i from Idea i where i.hackathonId = :hackathonId and (i.approvalStatus is null or i.approvalStatus = 'approved') order by i.createdAt desc")
	Page<Idea> findByHackathonIdOrderByCreatedAtDesc(UUID hackathonId, Pageable pageable);
	@Query("select i from Idea i where i.hackathonId = :hackathonId and i.status <> :status and (i.approvalStatus is null or i.approvalStatus = 'approved') order by i.createdAt desc")
	Page<Idea> findByHackathonIdAndStatusNotOrderByCreatedAtDesc(UUID hackathonId, Idea.Status status,
			Pageable pageable);
	@Query("select i from Idea i where i.hackathonId = :hackathonId and (i.approvalStatus is null or i.approvalStatus = 'approved')")
	List<Idea> findAllByHackathonId(UUID hackathonId);

	List<Idea> findByCreatedByOrderByCreatedAtDesc(UUID createdBy);
	List<Idea> findByApprovalHeadKeyOrderByCreatedAtDesc(String approvalHeadKey);

	@Query(value = "select i.* from ideas i where exists (select 1 from jsonb_array_elements("
			+ "case when jsonb_typeof(i.project_attachments) = 'array' then i.project_attachments else '[]'::jsonb end) a "
			+ "where a->>'storageKey' = :key)", nativeQuery = true)
	List<Idea> findByAttachmentKey(@Param("key") String key);
}
