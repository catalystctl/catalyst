-- Per-server CPU pinning (cpuset) and the node's reported CPU topology.
--
-- Server.cpuAffinity stores a canonical Linux cpuset list ("0-3,6"): the CPUs
-- this server's container may run on. NULL means no pinning, which is the
-- behaviour of every existing row, so nothing changes until an operator sets
-- one. The CFS quota in allocatedCpuCores keeps bounding how much CPU time the
-- container gets; the affinity only narrows where it may be spent.
--
-- Node.hostCpuSet is what the agent reports (health_report -> hostCpuSet): the
-- effective CPU set of the container parent cgroup, i.e. the CPUs containers on
-- that node can actually use. It is reported, not configured, so it stays NULL
-- until an agent that knows the field connects; the panel then validates a mask
-- against it and otherwise defers to the agent at container start.
ALTER TABLE "Server" ADD COLUMN IF NOT EXISTS "cpuAffinity" TEXT;
ALTER TABLE "Node" ADD COLUMN IF NOT EXISTS "hostCpuSet" TEXT;
