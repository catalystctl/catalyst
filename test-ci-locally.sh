#!/bin/bash
# Test GitHub Actions workflows locally using act
# Docs: https://github.com/nektos/act

set -e

echo "=== Testing CI/CD Locally with act ==="
echo ""

# Test specific workflow
test_workflow() {
    local workflow=$1
    echo "Testing workflow: $workflow"
    act -W ".github/workflows/$workflow" \
        --container-architecture linux/amd64 \
        -P self-hosted=node:20-bullseye
}

# Test specific job in workflow
test_job() {
    local workflow=$1
    local job=$2
    echo "Testing job '$job' in workflow: $workflow"
    act -W ".github/workflows/$workflow" \
        --container-architecture linux/amd64 \
        -P self-hosted=node:20-bullseye \
        -j "$job"
}

# List all workflows
list_workflows() {
    echo "Available workflows:"
    ls -1 .github/workflows/*.yml | xargs -I {} basename {}
}

# Show help
show_help() {
    cat << EOF
Usage: ./test-ci-locally.sh [command] [args]

Commands:
  list                          List all workflows
  test <workflow.yml>           Test entire workflow
  job <workflow.yml> <job-name> Test specific job
  backend                       Test backend-ci.yml
  agent                         Test agent-ci.yml
  help                          Show this help

Examples:
  ./test-ci-locally.sh list
  ./test-ci-locally.sh backend
  ./test-ci-locally.sh test backend-ci.yml
  ./test-ci-locally.sh job backend-ci.yml test
  
Note: 
- act uses Docker to run workflows
- Some GitHub-specific features may not work perfectly
- Use --dry-run to see what would run without executing
EOF
}

# Main script
case "$1" in
    list)
        list_workflows
        ;;
    test)
        if [ -z "$2" ]; then
            echo "Error: Workflow file required"
            echo "Usage: $0 test <workflow.yml>"
            exit 1
        fi
        test_workflow "$2"
        ;;
    job)
        if [ -z "$2" ] || [ -z "$3" ]; then
            echo "Error: Workflow and job name required"
            echo "Usage: $0 job <workflow.yml> <job-name>"
            exit 1
        fi
        test_job "$2" "$3"
        ;;
    backend)
        test_workflow "backend-ci.yml"
        ;;
    agent)
        test_workflow "agent-ci.yml"
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        echo "Unknown command: $1"
        echo ""
        show_help
        exit 1
        ;;
esac
