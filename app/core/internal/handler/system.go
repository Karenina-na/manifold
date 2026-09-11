package handler

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

func systemCPUPercent() (float64, error) {
	percents, err := cpu.Percent(0, false)
	if err != nil || len(percents) == 0 {
		return 0, err
	}
	return percents[0], nil
}

func systemCPUCores() (int, error) { return cpu.Counts(true) }

func systemMemory() (*mem.VirtualMemoryStat, error) { return mem.VirtualMemory() }

func systemLoad() (*load.AvgStat, error) { return load.Avg() }

func systemDisk(databasePath string) (*disk.UsageStat, error) {
	return disk.Usage(filepath.Dir(databasePath))
}

func systemProcess() (*process.Process, error) {
	return process.NewProcess(int32(os.Getpid()))
}

func systemHost() model.SystemHost {
	status := model.SystemHost{}
	if info, err := host.Info(); err == nil {
		status.Hostname = info.Hostname
		status.OS = info.OS
		status.Platform = info.Platform
		status.KernelArch = info.KernelArch
	}
	return status
}

// systemResources samples host metrics via gopsutil. Individual metric failures
// degrade to zero values: resource sampling is observational data and must not
// fail the health query the way store reads do.
func systemResources(databasePath string) (model.SystemResources, uint64) {
	resources := model.SystemResources{}
	if percents, err := systemCPUPercent(); err == nil {
		resources.CPUPercent = percents
	}
	if counts, err := systemCPUCores(); err == nil {
		resources.CPUCores = counts
	}
	if vm, err := systemMemory(); err == nil {
		resources.MemTotalBytes = vm.Total
		resources.MemUsedBytes = vm.Used
		resources.MemUsedPercent = vm.UsedPercent
	}
	if avg, err := systemLoad(); err == nil {
		resources.LoadAvg1 = avg.Load1
		resources.LoadAvg5 = avg.Load5
		resources.LoadAvg15 = avg.Load15
	}
	if usage, err := systemDisk(databasePath); err == nil {
		resources.DiskTotalBytes = usage.Total
		resources.DiskUsedBytes = usage.Used
		resources.DiskUsedPercent = usage.UsedPercent
	}
	var rssBytes uint64
	if proc, err := systemProcess(); err == nil {
		if info, err := proc.MemoryInfo(); err == nil {
			rssBytes = info.RSS
		}
	}
	return resources, rssBytes
}
