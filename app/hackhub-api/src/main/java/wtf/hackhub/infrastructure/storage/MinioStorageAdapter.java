package wtf.hackhub.infrastructure.storage;

import io.minio.*;
import io.minio.http.Method;
import org.springframework.stereotype.Component;
import wtf.hackhub.application.storage.StoragePort;

import java.io.InputStream;
import java.net.URI;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class MinioStorageAdapter implements StoragePort {

	private final MinioClient minioClient;
	private final ConcurrentHashMap<String, Boolean> initializedBuckets = new ConcurrentHashMap<>();

	public MinioStorageAdapter(MinioClient minioClient) {
		this.minioClient = minioClient;
	}

	@Override
	public String upload(String bucket, String key, InputStream data, long size, String contentType) {
		try {
			minioClient.putObject(PutObjectArgs.builder().bucket(bucket).object(key).stream(data, size, -1)
					.contentType(contentType).build());
			return key;
		} catch (Exception e) {
			throw new StorageException("Upload failed: " + key, e);
		}
	}

	@Override
	public String presignedDownloadUrl(String bucket, String key, int expirySeconds) {
		try {
			String signedUrl = minioClient.getPresignedObjectUrl(GetPresignedObjectUrlArgs.builder().method(Method.GET)
					.bucket(bucket).object(key).expiry(expirySeconds, TimeUnit.SECONDS).build());
			URI uri = URI.create(signedUrl);
			return "/storage" + uri.getRawPath() + (uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery());
		} catch (Exception e) {
			throw new StorageException("Failed to generate pre-signed URL for: " + key, e);
		}
	}

	@Override
	public void delete(String bucket, String key) {
		try {
			minioClient.removeObject(RemoveObjectArgs.builder().bucket(bucket).object(key).build());
		} catch (Exception e) {
			throw new StorageException("Delete failed: " + key, e);
		}
	}

	@Override
	public void ensureBucketExists(String bucket) {
		// Only initialization is serialized per bucket; uploads proceed independently.
		// Failed initialization is not cached, so a later request can retry.
		initializedBuckets.computeIfAbsent(bucket, name -> {
			try {
				if (!minioClient.bucketExists(BucketExistsArgs.builder().bucket(name).build())) {
					try {
						minioClient.makeBucket(MakeBucketArgs.builder().bucket(name).build());
					} catch (Exception creationFailure) {
						// Another API instance may have created it after our existence check.
						if (!minioClient.bucketExists(BucketExistsArgs.builder().bucket(name).build()))
							throw creationFailure;
					}
				}
				return true;
			} catch (Exception e) {
				throw new StorageException("Failed to ensure bucket exists: " + name, e);
			}
		});
	}

	public static class StorageException extends RuntimeException {
		public StorageException(String message, Throwable cause) {
			super(message, cause);
		}
	}
}
