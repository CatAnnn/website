package wtf.hackhub.infrastructure.storage;

import io.minio.MinioClient;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.testcontainers.containers.MinIOContainer;
import wtf.hackhub.application.storage.UploadFileUseCase;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Random;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

@Tag("integration")
class ConcurrentStorageIT {
	static final MinIOContainer MINIO = new MinIOContainer("minio/minio:latest");
	static { MINIO.start(); }

	@Test
	void concurrent_photo_reads_and_uploads_preserve_bytes() throws Exception {
		int clients = Integer.getInteger("concurrency.clients", 50);
		var minio = MinioClient.builder().endpoint(MINIO.getS3URL())
				.credentials(MINIO.getUserName(), MINIO.getPassword()).build();
		var storage = new MinioStorageAdapter(minio);
		var upload = new UploadFileUseCase(storage);
		var photo = new BufferedImage(600, 800, BufferedImage.TYPE_INT_RGB);
		var random = new Random(42);
		for (int y = 0; y < photo.getHeight(); y++)
			for (int x = 0; x < photo.getWidth(); x++) photo.setRGB(x, y, random.nextInt());
		var output = new ByteArrayOutputStream();
		ImageIO.write(photo, "jpg", output);
		byte[] bytes = output.toByteArray();
		var file = new MockMultipartFile("file", "photo.jpg", "image/jpeg", bytes);
		var existing = upload.execute(file, "fixture-photos", "photos");
		String proxy = System.getenv("CONCURRENCY_STORAGE_PROXY");
		String url = proxy == null ? MINIO.getS3URL() + existing.url().substring("/storage".length())
				: proxy + existing.url();
		var start = new CountDownLatch(1);
		java.util.List<Long> timings = Collections.synchronizedList(new ArrayList<>());
		try (var executor = Executors.newFixedThreadPool(clients);
				var http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build()) {
			var futures = new ArrayList<java.util.concurrent.Future<?>>();
			for (int i = 0; i < clients; i++) {
				final int index = i;
				futures.add(executor.submit(() -> {
					try {
						start.await();
						long began = System.nanoTime();
						if (index % 10 == 0) {
							var result = upload.execute(file, "fixture-photos", "photos");
							assertThat(result.key()).startsWith("photos/");
						} else {
							var response = http.send(HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(20)).build(),
									HttpResponse.BodyHandlers.ofByteArray());
							assertThat(response.statusCode()).isEqualTo(200);
							assertThat(Arrays.equals(bytes, response.body())).isTrue();
							if (proxy != null) assertThat(response.headers().firstValue("Cache-Control").orElse("")).isEqualTo("private, max-age=300");
						}
						timings.add(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - began));
					} catch (Exception ex) {
						// Do not include request objects or signed URLs in assertion messages.
						throw new AssertionError("Storage operation failed: " + ex.getClass().getSimpleName());
					}
				}));
			}
			start.countDown();
			for (var future : futures) future.get(30, TimeUnit.SECONDS);
		}
		Collections.sort(timings);
		assertThat(timings).hasSize(clients);
		System.out.printf("CONCURRENCY photo-read-upload clients=%d photo_bytes=%d p50_ms=%d p95_ms=%d max_ms=%d%n", clients, bytes.length,
				timings.get(clients / 2), timings.get((int) Math.ceil(clients * .95) - 1), timings.get(clients - 1));
	}

}
