#!/bin/sh

set -eu

project_directory=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
release_file="$project_directory/.release.env"
previous_release_file="$project_directory/.release.previous.env"
base_compose_file="$project_directory/docker-compose.yml"
registry_compose_file="$project_directory/deploy/docker-compose.ghcr.yml"

compose() {
  docker compose \
    --env-file "$project_directory/.env" \
    --env-file "$release_file" \
    -f "$base_compose_file" \
    -f "$registry_compose_file" \
    "$@"
}

read_release_tag() {
  file=$1
  if [ ! -f "$file" ]; then
    return 0
  fi
  sed -n 's/^COLLABDOCS_IMAGE_TAG=//p' "$file" | tail -n 1
}

validate_release_tag() {
  tag=$1
  case "$tag" in
    "" | *[!a-zA-Z0-9._-]*)
      echo "Invalid CollabDocs image tag: $tag" >&2
      exit 2
      ;;
  esac
}

write_release_tag() {
  tag=$1
  target=$2
  temporary_file="${target}.tmp.$$"
  printf 'COLLABDOCS_IMAGE_TAG=%s\n' "$tag" > "$temporary_file"
  chmod 600 "$temporary_file"
  mv -f "$temporary_file" "$target"
}

deploy_stack() {
  if [ ! -f "$project_directory/.env" ]; then
    echo "Missing production environment file: $project_directory/.env" >&2
    exit 2
  fi

  compose pull migrate web realtime
  compose up -d --no-build postgres minio
  compose run --rm minio-init
  compose run --rm migrate
  compose up -d --no-build --no-deps --wait web
  compose up -d --no-build --no-deps --wait realtime
}

deploy_release() {
  next_tag=$1
  validate_release_tag "$next_tag"

  current_tag=$(read_release_tag "$release_file")
  if [ -n "$current_tag" ] && [ "$current_tag" != "$next_tag" ]; then
    write_release_tag "$current_tag" "$previous_release_file"
  fi

  write_release_tag "$next_tag" "$release_file"
  deploy_stack
}

rollback_release() {
  current_tag=$(read_release_tag "$release_file")
  previous_tag=$(read_release_tag "$previous_release_file")
  if [ -z "$previous_tag" ]; then
    echo "No previous CollabDocs release is available for rollback." >&2
    exit 2
  fi

  validate_release_tag "$previous_tag"
  write_release_tag "$previous_tag" "$release_file"
  if [ -n "$current_tag" ]; then
    write_release_tag "$current_tag" "$previous_release_file"
  fi
  deploy_stack
}

cleanup_images() {
  current_tag=$(read_release_tag "$release_file")
  previous_tag=$(read_release_tag "$previous_release_file")

  for repository in \
    ghcr.io/dandan1232/collabdocs-web \
    ghcr.io/dandan1232/collabdocs-realtime \
    ghcr.io/dandan1232/collabdocs-migrate
  do
    docker image ls "$repository" --format '{{.Tag}}' | while IFS= read -r tag; do
      case "$tag" in
        "" | "<none>" | "$current_tag" | "$previous_tag") continue ;;
      esac
      docker image rm "$repository:$tag" || true
    done
  done

  find "$project_directory" -maxdepth 1 -type f -name 'CollabDocs-*.tar' \
    -print -exec rm -f -- {} \;
}

command=${1:-}
case "$command" in
  deploy)
    if [ "$#" -ne 2 ]; then
      echo "Usage: $0 deploy IMAGE_TAG" >&2
      exit 2
    fi
    deploy_release "$2"
    ;;
  rollback)
    rollback_release
    ;;
  cleanup)
    cleanup_images
    ;;
  *)
    echo "Usage: $0 {deploy IMAGE_TAG|rollback|cleanup}" >&2
    exit 2
    ;;
esac
