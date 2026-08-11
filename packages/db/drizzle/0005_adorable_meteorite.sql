CREATE TABLE `organization_binding_authorization_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`auto_authorize_agent_profile_bindings` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "organization_binding_auth_prefs_id_non_empty_check" CHECK(length(trim("id")) > 0),
	CONSTRAINT "organization_binding_auth_prefs_org_non_empty_check" CHECK(length(trim("organization_id")) > 0),
	CONSTRAINT "organization_binding_auth_prefs_user_non_empty_check" CHECK(length(trim("user_id")) > 0),
	CONSTRAINT "organization_binding_auth_prefs_bool_check" CHECK("auto_authorize_agent_profile_bindings" in (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_binding_auth_prefs_org_user_uq_idx` ON `organization_binding_authorization_preferences` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `organization_binding_auth_prefs_user_idx` ON `organization_binding_authorization_preferences` (`user_id`);--> statement-breakpoint
WITH personal_owner AS (
  SELECT organization_id, user_id
  FROM (
    SELECT
      members.organization_id,
      members.user_id,
      row_number() OVER (
        PARTITION BY members.organization_id
        ORDER BY
          CASE members.role WHEN 'owner' THEN 0 ELSE 1 END,
          members.created_at ASC,
          members.id ASC
      ) AS owner_rank
    FROM members
    INNER JOIN organizations
      ON organizations.id = members.organization_id
    WHERE organizations.slug LIKE 'personal-%'
      OR (
        organizations.metadata IS NOT NULL
        AND json_valid(organizations.metadata)
        AND json_extract(organizations.metadata, '$.personal') = 1
      )
  )
  WHERE owner_rank = 1
),
personal_identity AS (
  SELECT
    organizations.id AS organization_id,
    coalesce(
      nullif(trim(users.name), ''),
      nullif(
        trim(
          CASE
            WHEN instr(users.email, '@') > 1
              THEN substr(users.email, 1, instr(users.email, '@') - 1)
            ELSE users.email
          END
        ),
        ''
      ),
      organizations.name
    ) AS display_name
  FROM organizations
  INNER JOIN personal_owner
    ON personal_owner.organization_id = organizations.id
  INNER JOIN users
    ON users.id = personal_owner.user_id
),
personal_slug_base AS (
  SELECT
    organization_id,
    display_name,
    lower(
      trim(
        replace(
          replace(
            replace(
              replace(
                replace(
                  replace(
                    replace(display_name, char(39), ''),
                    '&',
                    '-'
                  ),
                  '+',
                  '-'
                ),
                '.',
                '-'
              ),
              '_',
              '-'
            ),
            ' ',
            '-'
          ),
          '--',
          '-'
        ),
        '-'
      )
    ) AS slug_base
  FROM personal_identity
),
personal_slug_rank AS (
  SELECT
    organization_id,
    display_name,
    CASE
      WHEN slug_base IN (
        'accept-invitation',
        'account',
        'admin',
        'agent',
        'agent-profiles',
        'agents',
        'api',
        'auth',
        'billing',
        'center-agent',
        'computer',
        'computers',
        'desktop',
        'device',
        'download',
        'downloads',
        'help',
        'login',
        'logout',
        'mail',
        'magic-link',
        'organization',
        'organizations',
        'profile',
        'profiles',
        'security',
        'settings',
        'sign-in',
        'sign-up',
        'space',
        'spaces',
        'support',
        'verify-email',
        'openmeld',
        'www'
      )
        THEN slug_base || '-2'
      WHEN slug_base = ''
        THEN 'personal'
      ELSE slug_base
    END AS preferred_slug
  FROM personal_slug_base
),
personal_slug_assignment AS (
  SELECT
    organization_id,
    display_name,
    CASE
      WHEN row_number() OVER (
        PARTITION BY preferred_slug
        ORDER BY organization_id ASC
      ) = 1
        AND NOT EXISTS (
          SELECT 1
          FROM organizations AS existing_organizations
          WHERE existing_organizations.slug = preferred_slug
            AND existing_organizations.id <> personal_slug_rank.organization_id
            AND existing_organizations.id NOT IN (
              SELECT organization_id FROM personal_owner
            )
        )
        THEN preferred_slug
      ELSE preferred_slug || '-' || (
        row_number() OVER (
          PARTITION BY preferred_slug
          ORDER BY organization_id ASC
        ) + 1
      )
    END AS assigned_slug
  FROM personal_slug_rank
)
UPDATE organizations
SET
  name = (
    SELECT display_name
    FROM personal_slug_assignment
    WHERE personal_slug_assignment.organization_id = organizations.id
  ),
  slug = (
    SELECT assigned_slug
    FROM personal_slug_assignment
    WHERE personal_slug_assignment.organization_id = organizations.id
  ),
  metadata = json_set(
    CASE
      WHEN metadata IS NOT NULL AND json_valid(metadata)
        THEN CASE
          WHEN json_type(metadata) = 'object' THEN metadata
          ELSE '{}'
        END
      ELSE '{}'
    END,
    '$.personal',
    json('true')
  )
WHERE id IN (
  SELECT organization_id
  FROM personal_slug_assignment
);
