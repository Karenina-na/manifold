package system

import (
	"os"
	"path/filepath"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/load"
	"github.com/shirou/gopsutil/v4/mem"
	"github.com/shirou/gopsutil/v4/process"

	"github.com/manifold-space/manifold/app/core/internal/model"
)

func cpuPercent() (float64, error) {
	percents, err := cpu.Percent(0, false)
	if err != nil || len(percents) == 0 {
		return 0, err
	}
	return percents[0], nil
}

func cpuCores() (int, error) { return cpu.Counts(true) }

func memory() (*mem.VirtualMemoryStat, error) { return mem.VirtualMemory() }

func loadAverage() (*load.AvgStat, error) { return load.Avg() }

func diskUsage(databasePath string) (*disk.UsageStat, error) {
	return disk.Usage(filepath.Dir(databasePath))
}

func currentProcess() (*process.Process, error) {
	return process.NewProcess(int32(os.Getpid()))
}

func hostStatus() model.SystemHost {
	status := model.SystemHost{}
	if info, err := host.Info(); err == nil {
		status.Hostname = info.Hostname
		status.OS = info.OS
		status.Platform = info.Platform
		status.KernelArch = info.KernelArch
	}
	return status
}

// Snapshot samples host metrics via gopsutil. Individual metric failures
// degrade to zero values: resource sampling is observational data and must not
// fail the health query the way store reads do.
func Snapshot(databasePath string) (model.SystemResources, model.SystemHost, uint64) {
	resources := model.SystemResources{}
	if percents, err := cpuPercent(); err == nil {
		resources.CPUPercent = percents
	}
	if counts, err := cpuCores(); err == nil {
		resources.CPUCores = counts
	}
	if vm, err := memory(); err == nil {
		resources.MemTotalBytes = vm.Total
		resources.MemUsedBytes = vm.Used
		resources.MemUsedPercent = vm.UsedPercent
	}
	if avg, err := loadAverage(); err == nil {
		resources.LoadAvg1 = avg.Load1
		resources.LoadAvg5 = avg.Load5
		resources.LoadAvg15 = avg.Load15
	}
	if usage, err := diskUsage(databasePath); err == nil {
		resources.DiskTotalBytes = usage.Total
		resources.DiskUsedBytes = usage.Used
		resources.DiskUsedPercent = usage.UsedPercent
	}
	var rssBytes uint64
	if proc, err := currentProcess(); err == nil {
		if info, err := proc.MemoryInfo(); err == nil {
			rssBytes = info.RSS
		}
	}
	return resources, hostStatus(), rssBytes
}
