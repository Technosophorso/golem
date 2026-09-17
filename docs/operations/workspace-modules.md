# Workspace module contract

Workspace modules let a deployment add an optional product surface without tying its lifecycle to Home navigation, assistant grants, or a particular tenant. The default registry currently includes the generic `association` module. New workspaces start with it disabled.

## Extension seam

A module integrates through four pieces:

1. Register a stable key and default lifecycle state with `defineWorkspaceModuleRegistry`.
2. Pass that registry to `createWorkspaceModulesStore` and `workspaceModuleRoutes`.
3. Optionally provide a lifecycle adapter whose `readBlockingWork` reports nonnegative named counts that must reach zero before a drain can finish.
4. Lock the module first in any domain transaction that creates new work, then call `requireWorkspaceModuleAdmission`. Reads and recovery of existing records remain available while the module is draining or disabled.

The shared store owns authorization, optimistic versions, state transitions, audit records, lazy provisioning, and transaction locking. The shared route owns registry discovery and lifecycle actions at `/api/workspaces/:workspaceId/modules/:moduleKey/actions`. Adding a registered module does not require editing Association storage, services, or route paths.

The database accepts stable module keys matching `^[a-z][a-z0-9_-]{0,62}$`. Application registries remain the admission boundary, so an arbitrary database key does not become a callable module. Migration `551_workspace_module_registry.sql` widens only the storage constraint and remains append-only.

## Association adapter

`packages/api/src/association/workspace-module.ts` is the Association-owned adapter. It registers pending orders as blocking work, supplies the legacy `pendingOrders` response field, and gives Association transactions named lock and admission helpers. Association business tables and messages do not leak into the generic lifecycle store or route.

The default registry's compatibility metadata projects the `pending_orders` blocker into `pendingOrders` for existing HTTP clients. Other modules may omit compatibility metadata or declare their own projection without changing routing logic.

## Portability proof

The shared contract test creates an independent registry. The API route test sends a lifecycle action to a test-only second module and verifies its compatibility projection. The PostgreSQL integration test registers that module, observes a version-zero missing state, enables it, drains it against a custom blocker, and finishes disablement after the blocker clears. Those tests import no Association service code for the second module.

Deployment-specific manifests, source mappings, provider credentials, tenant prices, policy, and migration orchestration belong in the consuming deployment repository. Brian accepts parameterized manifests and provider-neutral lineage; it does not own the consumer's source-system extraction or cutover decisions.
