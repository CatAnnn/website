package wtf.hackhub.infrastructure.persistence.auth;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import wtf.hackhub.domain.Profile;

import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ProfileRepository extends JpaRepository<Profile, UUID> {

	Optional<Profile> findByEmail(String email);

	boolean existsByEmail(String email);

	boolean existsByEmailIgnoreCase(String email);

	// 按字面包含匹配，避免将邮箱或姓名中的百分号、下划线当作通配符。
	@Query("""
			SELECT p FROM Profile p
			WHERE LOCATE(:query, LOWER(p.name)) > 0 OR LOCATE(:query, LOWER(p.email)) > 0
			ORDER BY CASE WHEN LOWER(p.name) = :query OR LOWER(p.email) = :query THEN 0 ELSE 1 END,
			LOWER(p.name), LOWER(p.email), p.id
			""")
	List<Profile> searchByNameOrEmail(String query, Pageable pageable);

	@Lock(LockModeType.PESSIMISTIC_WRITE)
	@Query("SELECT p FROM Profile p WHERE p.id = :id")
	Optional<Profile> findByIdForUpdate(UUID id);
}
