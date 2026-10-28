package wtf.hackhub.infrastructure.storage;

import io.minio.BucketExistsArgs;
import io.minio.MakeBucketArgs;
import io.minio.MinioClient;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.util.ArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class MinioStorageAdapterTest {

	@Test
	void concurrent_uploads_initialize_the_bucket_once() throws Exception {
		MinioClient client = mock(MinioClient.class);
		when(client.bucketExists(any(BucketExistsArgs.class))).thenReturn(false);
		var storage = new MinioStorageAdapter(client);
		try (var executor = Executors.newFixedThreadPool(20)) {
			var requests = new ArrayList<java.util.concurrent.Future<?>>();
			for (int i = 0; i < 50; i++)
				requests.add(executor.submit(() -> storage.ensureBucketExists("fixture-photos")));
			for (var request : requests) request.get(5, TimeUnit.SECONDS);
		}
		verify(client, times(1)).bucketExists(any(BucketExistsArgs.class));
		verify(client, times(1)).makeBucket(any(MakeBucketArgs.class));
	}

	@Test
	void failed_initialization_is_retried() throws Exception {
		MinioClient client = mock(MinioClient.class);
		when(client.bucketExists(any(BucketExistsArgs.class))).thenThrow(new IOException("offline")).thenReturn(true);
		var storage = new MinioStorageAdapter(client);
		assertThatThrownBy(() -> storage.ensureBucketExists("fixture-photos"))
				.isInstanceOf(MinioStorageAdapter.StorageException.class);
		storage.ensureBucketExists("fixture-photos");
		storage.ensureBucketExists("fixture-photos");
		verify(client, times(2)).bucketExists(any(BucketExistsArgs.class));
	}

	@Test
	void another_instance_creating_the_bucket_does_not_fail_the_upload() throws Exception {
		MinioClient client = mock(MinioClient.class);
		when(client.bucketExists(any(BucketExistsArgs.class))).thenReturn(false, true);
		doThrow(new IOException("created concurrently")).when(client).makeBucket(any(MakeBucketArgs.class));
		var storage = new MinioStorageAdapter(client);
		storage.ensureBucketExists("fixture-photos");
		storage.ensureBucketExists("fixture-photos");
		verify(client, times(2)).bucketExists(any(BucketExistsArgs.class));
		verify(client, times(1)).makeBucket(any(MakeBucketArgs.class));
	}
}
