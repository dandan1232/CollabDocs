import { S3Client } from "@aws-sdk/client-s3";

interface AssetStorageConfig {
  bucket: string;
  client: S3Client;
}

let storage: AssetStorageConfig | undefined;

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value)
    throw new Error(`Missing required asset storage setting: ${name}`);
  return value;
}

export function getAssetStorage(): AssetStorageConfig {
  if (!storage) {
    storage = {
      bucket: requiredEnvironment("S3_BUCKET"),
      client: new S3Client({
        endpoint: requiredEnvironment("S3_ENDPOINT"),
        region: process.env.S3_REGION?.trim() || "us-east-1",
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
        credentials: {
          accessKeyId: requiredEnvironment("S3_ACCESS_KEY"),
          secretAccessKey: requiredEnvironment("S3_SECRET_KEY"),
        },
      }),
    };
  }

  return storage;
}
