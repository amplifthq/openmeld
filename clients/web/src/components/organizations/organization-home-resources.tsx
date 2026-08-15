"use client";

import { FilesIcon, FileTextIcon, FolderOpenIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { documentKindLabel } from "#/components/organization-documents/organization-document-browser-model";
import { StaleDataNotice } from "#/components/stale-data-notice";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationDocumentPath,
	buildOrganizationDocumentsPath,
	buildOrganizationProjectPath,
	buildOrganizationProjectsPath,
} from "#/lib/organizations/organization-routes";
import { organizationDocumentsQueryOptions } from "#/query/organizations/organization-documents";
import { projectsQueryOptions } from "#/query/organizations/projects";
import { OrganizationHomeActivity } from "./organization-home-activity";
import {
	OrganizationHomeEmpty,
	OrganizationHomeError,
	OrganizationHomeList,
	OrganizationHomeListItem,
	OrganizationHomeListSkeleton,
	OrganizationHomePanel,
	OrganizationHomeSection,
} from "./organization-home-ui";

const HOME_RESOURCE_ITEM_LIMIT = 4;

export function OrganizationHomeResources() {
	const { currentOrganization } = useAppOrganization();
	const projectsQuery = useQuery(
		projectsQueryOptions({ organizationId: currentOrganization.id })
	);
	const documentsQuery = useQuery(
		organizationDocumentsQueryOptions({
			organizationId: currentOrganization.id,
		})
	);
	const projects = (projectsQuery.data?.projects ?? [])
		.filter((project) => project.archivedAtMs === null)
		.slice(0, HOME_RESOURCE_ITEM_LIMIT);
	const documents = (documentsQuery.data?.documents ?? []).slice(
		0,
		HOME_RESOURCE_ITEM_LIMIT
	);
	const resourcesAreStale =
		(projectsQuery.isError && Boolean(projectsQuery.data)) ||
		(documentsQuery.isError && Boolean(documentsQuery.data));

	return (
		<OrganizationHomeSection title="Resources">
			<OrganizationHomeActivity
				headingLevel={3}
				organizationId={currentOrganization.id}
				organizationSlug={currentOrganization.slug}
			/>
			{resourcesAreStale ? (
				<StaleDataNotice
					className="mx-0 mt-0"
					label="Resources may be out of date."
					onRetry={() =>
						Promise.all([projectsQuery.refetch(), documentsQuery.refetch()])
					}
				/>
			) : null}
			<div className="grid min-w-0 gap-4 lg:grid-cols-2">
				<OrganizationHomePanel
					href={buildOrganizationProjectsPath(currentOrganization.slug)}
					title="Projects"
				>
					{projectsQuery.isPending ? <OrganizationHomeListSkeleton /> : null}
					{projectsQuery.isError && !projectsQuery.data ? (
						<OrganizationHomeError
							label="Couldn’t load Projects."
							onRetry={() => projectsQuery.refetch()}
						/>
					) : null}
					{projectsQuery.data &&
					!projectsQuery.isError &&
					projects.length === 0 ? (
						<OrganizationHomeEmpty
							actionHref={buildOrganizationProjectsPath(
								currentOrganization.slug
							)}
							actionLabel="Open Projects"
							icon={<FolderOpenIcon aria-hidden="true" className="size-4" />}
							label="No Projects yet"
						/>
					) : null}
					{projects.length > 0 ? (
						<OrganizationHomeList>
							{projects.map((project) => (
								<OrganizationHomeListItem
									href={buildOrganizationProjectPath({
										orgSlug: currentOrganization.slug,
										projectId: project.id,
									})}
									icon={
										<FolderOpenIcon aria-hidden="true" className="size-4" />
									}
									itemId={project.id}
									key={project.id}
									title={project.name}
								/>
							))}
						</OrganizationHomeList>
					) : null}
				</OrganizationHomePanel>

				<OrganizationHomePanel
					href={buildOrganizationDocumentsPath(currentOrganization.slug)}
					title="Documents"
				>
					{documentsQuery.isPending ? <OrganizationHomeListSkeleton /> : null}
					{documentsQuery.isError && !documentsQuery.data ? (
						<OrganizationHomeError
							label="Couldn’t load Documents."
							onRetry={() => documentsQuery.refetch()}
						/>
					) : null}
					{documentsQuery.data &&
					!documentsQuery.isError &&
					documents.length === 0 ? (
						<OrganizationHomeEmpty
							actionHref={buildOrganizationDocumentsPath(
								currentOrganization.slug
							)}
							actionLabel="Open Documents"
							icon={<FilesIcon aria-hidden="true" className="size-4" />}
							label="No Documents yet"
						/>
					) : null}
					{documents.length > 0 ? (
						<OrganizationHomeList>
							{documents.map((document) => (
								<OrganizationHomeListItem
									href={buildOrganizationDocumentPath({
										documentId: document.id,
										orgSlug: currentOrganization.slug,
									})}
									icon={<FileTextIcon aria-hidden="true" className="size-4" />}
									itemId={document.id}
									key={document.id}
									meta={documentKindLabel(document.kind)}
									title={document.title}
								/>
							))}
						</OrganizationHomeList>
					) : null}
				</OrganizationHomePanel>
			</div>
		</OrganizationHomeSection>
	);
}
