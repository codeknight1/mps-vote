"use client"

import PoetAvatar from "@/components/poet-avatar"
import { useState, useEffect, useCallback } from "react"
import type { VoteSelection, Team, Participant } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import VotingCard from "@/components/voting-card"
import { ArrowLeft, Lock, AlertCircle, Flame, Clock } from "lucide-react"
import { Spinner, LoadingSpinner } from "@/components/ui/spinner"
import Link from "next/link"
import Image from "next/image"
import { toast } from "sonner"

import { getPreset, type StagePreset } from "@/lib/stages"

import { formatCountdown } from "@/lib/countdown"

// Danger-list poets are shown in a random order.
function shuffle<T>(items: T[]): T[] {
  const next = [...items]
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[next[i], next[j]] = [next[j], next[i]]
  }
  return next
}

export default function VotePage() {
  const [selections, setSelections] = useState<VoteSelection>([])
  const [votingCode, setVotingCode] = useState("")
  const [codeVerified, setCodeVerified] = useState(false)
  const [codeInput, setCodeInput] = useState("")
  const [error, setError] = useState("")
  const [hasVoted, setHasVoted] = useState(false)
  const [codeHasVoted, setCodeHasVoted] = useState(false)
  const [teams, setTeams] = useState<Team[]>([])
  const [participants, setParticipants] = useState<Participant[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isSubmittingVotes, setIsSubmittingVotes] = useState(false)
  const [teamLabel, setTeamLabel] = useState("Team")
  const [preset, setPreset] = useState<StagePreset>(getPreset(null))
  // Grouped danger stages (Battle Round, Semi Final) show poets under their
  // team banner with the coach; the Blind Audition list stays flat.
  const [dangerGroups, setDangerGroups] = useState<
    { id: string; name: string; color: string; coach?: { name?: string; image?: string }; poets: Participant[] }[]
  >([])
  const [deadline, setDeadline] = useState<Date | null>(null)
  const [votingStart, setVotingStart] = useState<Date | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const mode = preset.mode

  // Tick every second while a schedule is set so the countdowns stay live and
  // the page flips open/closed the moment a boundary passes.
  useEffect(() => {
    if (!deadline && !votingStart) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [deadline, votingStart])

  const deadlinePassed = deadline ? now > deadline.getTime() : false
  const startPending = votingStart ? now < votingStart.getTime() : false

  const fetchTeams = useCallback(async () => {
    try {
      setIsLoading(true)
      setLoadError(null)
      const [teamsResponse, labelResponse, presetResponse, deadlineResponse, startResponse] = await Promise.all([
        fetch("/api/teams", { cache: "no-store" }),
        fetch("/api/settings/label", { cache: "no-store" }),
        fetch("/api/settings/preset", { cache: "no-store" }),
        fetch("/api/settings/deadline", { cache: "no-store" }),
        fetch("/api/settings/start", { cache: "no-store" }),
      ])

      if (!teamsResponse.ok) {
        throw new Error("Failed to load teams")
      }

      if (labelResponse.ok) {
        const labelData = await labelResponse.json()
        setTeamLabel(labelData.label || "Team")
      }

      if (deadlineResponse.ok) {
        const deadlineData = await deadlineResponse.json()
        const parsedDeadline = deadlineData?.deadline ? new Date(deadlineData.deadline) : null
        setDeadline(parsedDeadline && !Number.isNaN(parsedDeadline.getTime()) ? parsedDeadline : null)
      }
      if (startResponse.ok) {
        const startData = await startResponse.json()
        const parsedStart = startData?.start ? new Date(startData.start) : null
        setVotingStart(parsedStart && !Number.isNaN(parsedStart.getTime()) ? parsedStart : null)
      }

      let currentPreset = getPreset(null)
      if (presetResponse.ok) {
        const presetData = await presetResponse.json()
        currentPreset = getPreset(presetData.preset)
      }
      setPreset(currentPreset)

      const data = await teamsResponse.json()
      const allTeams: Team[] = data?.teams ?? []

      if (currentPreset.mode === "danger") {
        // Danger-list stage: only flagged poets are votable, in random order.
        setTeams([])
        const dangerPoets: Participant[] = []
        const groups: { id: string; name: string; color: string; coach?: { name?: string; image?: string }; poets: Participant[] }[] = []
        allTeams.forEach((team) => {
          const flagged = (team.participants ?? []).filter((p) => p.inDanger)
          if (!flagged.length) return
          const poets = shuffle(flagged.map((p) => ({ ...p, teamId: team.id })))
          dangerPoets.push(...poets)
          groups.push({ id: team.id, name: team.name, color: team.color, coach: team.coach, poets })
        })
        setParticipants(currentPreset.dangerLayout === "grouped" ? dangerPoets : shuffle(dangerPoets))
        setDangerGroups(groups)
      } else {
        // Regular stage: only teams the admin has opened are votable.
        const openTeams = allTeams.filter((team) => team.votingOpen)
        setTeams(openTeams)

        const allParticipants: Participant[] = []
        openTeams.forEach((team) => {
          team.participants?.forEach((participant) => {
            allParticipants.push({ ...participant, teamId: team.id })
          })
        })
        setParticipants(allParticipants)
      }
    } catch (error: any) {
      setLoadError(error?.message ?? "Failed to load teams")
      console.error("[VOTE_PAGE_FETCH_ERROR]", error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    const stored = localStorage.getItem("votingCode")
    const votedCodes = JSON.parse(localStorage.getItem("votedCodes") || "[]")
    if (stored) {
      setVotingCode(stored)
      // Verify code with API
      fetch("/api/tickets/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: stored }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.valid) {
            setCodeVerified(true)
            if (data.ticket?.hasVoted || votedCodes.includes(stored)) {
              setCodeHasVoted(true)
            }
          }
        })
        .catch(() => {
          // If verification fails, still allow them to try
          setCodeVerified(true)
        })
    }
  }, [])

  useEffect(() => {
    if (codeVerified) {
      fetchTeams()
    }
  }, [codeVerified, fetchTeams])

  // One ticket = one vote: picking a poet replaces any previous pick,
  // tapping the selected poet again deselects them.
  const handleVoteSelect = (teamId: string, participantId: string) => {
    setSelections((prev) => {
      if (prev.some((s) => s.participantId === participantId)) {
        return []
      }
      return [{ teamId, participantId }]
    })
  }

  const handleVerifyCode = async () => {
    if (!codeInput.trim()) {
      setError("Please enter your voting code")
      return
    }

    try {
      setError("")
      const response = await fetch("/api/tickets/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: codeInput.trim() }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData?.error ?? "Invalid voting code")
      }

      const data = await response.json()

      if (data.ticket?.hasVoted) {
        setError("This code has already been used to vote. Purchase a new ticket to vote again.")
        setCodeHasVoted(true)
        return
      }

      setVotingCode(codeInput.trim().toUpperCase())
      setCodeVerified(true)
      localStorage.setItem("votingCode", codeInput.trim().toUpperCase())
      setError("")
    } catch (error: any) {
      setError(error?.message ?? "Failed to verify code. Please try again.")
    }
  }

  const handleSubmitVotes = async () => {
    if (selections.length !== 1) {
      toast.error("Please select the one poet you want to vote for")
      return
    }

    try {
      setIsSubmittingVotes(true)
      const response = await fetch("/api/votes/cast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          votingCode: votingCode,
          selections: selections,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData?.error ?? "Failed to submit vote")
      }

      // Mark as voted in localStorage
      const votedCodes = JSON.parse(localStorage.getItem("votedCodes") || "[]")
      if (!votedCodes.includes(votingCode)) {
        votedCodes.push(votingCode)
        localStorage.setItem("votedCodes", JSON.stringify(votedCodes))
      }

      setCodeHasVoted(true)
      setHasVoted(true)
      toast.success("Vote cast successfully!")
    } catch (error: any) {
      toast.error(error?.message ?? "Failed to submit vote. Please try again.")
    } finally {
      setIsSubmittingVotes(false)
    }
  }

  const selectedParticipant = participants.find((p) => p.id === selections[0]?.participantId)
  const hasVotableContent = mode === "danger" ? participants.length > 0 : teams.length > 0

  if (!codeVerified) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-secondary to-background">
        <nav className="border-b border-border/40 bg-background/80 backdrop-blur-xl sticky top-0 z-40">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
            <Link href="/" className="flex items-center gap-2 hover:opacity-70 transition-opacity">
              <ArrowLeft className="w-5 h-5" />
              <h1 className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                MPS Media Poetry Challenge
              </h1>
            </Link>
          </div>
        </nav>

        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <Card className="bg-card/50 border-border/40 backdrop-blur shadow-2xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="w-5 h-5 text-primary" />
                Code Required to Vote
              </CardTitle>
              <CardDescription>Enter your voting code to proceed</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <label className="block text-sm font-semibold text-foreground mb-3">Voting Code</label>
                <Input
                  placeholder="MPS-2025-ABC123"
                  value={codeInput}
                  onChange={(e) => {
                    setCodeInput(e.target.value.toUpperCase())
                    setError("")
                  }}
                  className="bg-input border-border/40 text-foreground placeholder:text-muted-foreground focus:border-primary/50 transition-colors text-lg tracking-widest text-center font-mono"
                />
              </div>
              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex gap-3">
                  <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-red-600 text-sm">{error}</p>
                </div>
              )}
              <Button
                onClick={handleVerifyCode}
                className="w-full bg-gradient-to-r from-primary to-accent hover:shadow-lg hover:shadow-primary/20"
                size="lg"
              >
                Enter Code & Vote
              </Button>
              <Link href="/purchase" className="block">
                <Button variant="outline" className="w-full bg-transparent">
                  Don't have a code? Get one now
                </Button>
              </Link>
              <Link href="/resend-code" className="block text-center text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4">
                Lost your code? Re-send it to my email
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }



  if (hasVoted || codeHasVoted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-secondary to-background">
        <nav className="border-b border-border/40 bg-background/80 backdrop-blur-xl sticky top-0 z-40">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
            <Link href="/" className="flex items-center gap-2 hover:opacity-70 transition-opacity">
              <ArrowLeft className="w-5 h-5" />
              <h1 className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                MPS Media Poetry Challenge
              </h1>
            </Link>
          </div>
        </nav>

        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <Card className="bg-card/50 border-border/40 backdrop-blur shadow-2xl">
            <CardContent className="pt-12 text-center pb-12">
              <div className="mb-6 flex justify-center">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-accent to-primary flex items-center justify-center">
                  <span className="text-3xl">✓</span>
                </div>
              </div>
              <h3 className="text-2xl sm:text-3xl font-bold text-foreground mb-3">Your Vote is Recorded!</h3>
              <p className="text-muted-foreground mb-2">Thank you for voting in the MPS Media Poetry Challenge</p>
              <p className="text-sm text-muted-foreground mb-8">This code has completed its voting.</p>
              <div className="space-y-4">
                <Link href="/">
                  <Button
                    className="w-full bg-gradient-to-r from-primary to-accent hover:shadow-lg hover:shadow-primary/20"
                    size="lg"
                  >
                    Back to Home
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-secondary to-background">
      <nav className="border-b border-border/40 bg-background/80 backdrop-blur-xl sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <Link href="/" className="flex items-center gap-2 hover:opacity-70 transition-opacity">
            <ArrowLeft className="w-5 h-5" />
            <h1 className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              MPS Media Poetry Challenge
            </h1>
          </Link>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <LoadingSpinner size="xl" text="Loading poets..." />
          </div>
        )}

        {loadError && (
          <Card className="bg-destructive/10 border-destructive/30 mb-6">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-destructive" />
                <p className="text-destructive">{loadError}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {!isLoading && !loadError && startPending && votingStart && (
          <Card className="bg-card/50 border-border/40 backdrop-blur">
            <CardContent className="pt-6 text-center py-12">
              <Clock className="w-8 h-8 mx-auto mb-3 text-primary" />
              <p className="text-lg font-semibold text-foreground mb-1">Voting hasn&apos;t started yet</p>
              <p className="text-3xl sm:text-4xl font-extrabold text-primary tabular-nums my-3">
                {formatCountdown(votingStart.getTime() - now)}
              </p>
              <p className="text-muted-foreground">
                Hold on to your voting code — this page opens automatically when the countdown ends.
              </p>
            </CardContent>
          </Card>
        )}

        {!isLoading && !loadError && !startPending && deadlinePassed && (
          <Card className="bg-card/50 border-border/40 backdrop-blur">
            <CardContent className="pt-6 text-center py-12">
              <Clock className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
              <p className="text-lg font-semibold text-foreground mb-1">Voting has closed</p>
              <p className="text-muted-foreground">
                This stage's voting deadline has passed. Follow MPS Media for the official results.
              </p>
            </CardContent>
          </Card>
        )}

        {!isLoading && !loadError && !startPending && !deadlinePassed && !hasVotableContent && (
          <Card className="bg-card/50 border-border/40 backdrop-blur">
            <CardContent className="pt-6 text-center py-12">
              <p className="text-muted-foreground">Voting is not open right now. Please check back later.</p>
            </CardContent>
          </Card>
        )}

        {!isLoading && !loadError && !startPending && !deadlinePassed && hasVotableContent && (
          <div className="grid lg:grid-cols-3 gap-6 sm:gap-8">
            <div className="lg:col-span-2">
              {deadline && (
                <div
                  className="flex items-center gap-2 mb-4 px-4 py-2.5 rounded-xl border text-sm font-semibold"
                  style={{
                    borderColor: `${preset.accentColor}55`,
                    background: `${preset.accentColor}0d`,
                    color: preset.accentColor,
                  }}
                >
                  <Clock className="w-4 h-4 flex-shrink-0" />
                  Voting closes in {formatCountdown(deadline.getTime() - now)}
                </div>
              )}
              {mode === "danger" ? (
                <>
                  {/* Danger-list stage: heading, copy and accent come from the stage preset */}
                  <div className="mb-6 sm:mb-8 animate-fade-in-up">
                    <Card
                      className="relative overflow-hidden border-2 mb-6 p-4 sm:p-6 shadow-lg rounded-2xl"
                      style={{
                        borderColor: preset.accentColor,
                        background: `linear-gradient(135deg, ${preset.accentColor}26, ${preset.accentColor}0a)`,
                      }}
                    >
                      <div className="absolute left-0 top-0 bottom-0 w-2" style={{ backgroundColor: preset.accentColor }} />
                      <div className="flex items-center gap-3 pl-2">
                        <div
                          className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 shadow-md"
                          style={{ backgroundColor: `${preset.accentColor}1a` }}
                        >
                          <Flame className="w-6 h-6" style={{ color: preset.accentColor }} />
                        </div>
                        <div>
                          <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight text-foreground">
                            {preset.heading}
                          </h2>
                          <p className="text-sm sm:text-base text-muted-foreground mt-1">{preset.description}</p>
                        </div>
                      </div>
                    </Card>
                  </div>

                  {preset.dangerLayout === "grouped" ? (
                    <div className="space-y-8 sm:space-y-10">
                      {dangerGroups.map((group) => (
                        <div key={group.id}>
                          {/* Team banner: these poets carry their team and coach */}
                          <Card
                            className="relative overflow-hidden border-2 mb-4 p-3 sm:p-4 shadow rounded-2xl"
                            style={{
                              borderColor: group.color,
                              background: `linear-gradient(135deg, ${group.color}26, ${group.color}0a)`,
                            }}
                          >
                            <div className="absolute left-0 top-0 bottom-0 w-2" style={{ backgroundColor: group.color }} />
                            <div className="flex items-center gap-3 pl-2">
                              <div
                                className="relative w-12 h-12 rounded-full overflow-hidden flex-shrink-0 border-[3px] shadow"
                                style={{ borderColor: group.color }}
                              >
                                <Image
                                  src={group.coach?.image || "/placeholder.svg"}
                                  alt={group.coach?.name ?? "Coach"}
                                  fill
                                  className="object-cover"
                                />
                              </div>
                              <div>
                                <h3 className="text-lg sm:text-xl font-extrabold tracking-tight text-foreground">
                                  {group.name}
                                </h3>
                                {group.coach?.name && (
                                  <p className="text-xs sm:text-sm text-muted-foreground">Coach: {group.coach.name}</p>
                                )}
                              </div>
                            </div>
                          </Card>
                          <div className="grid grid-cols-1 gap-3 sm:gap-4">
                            {group.poets.map((participant) => (
                              <VotingCard
                                key={participant.id}
                                participant={participant}
                                isSelected={selections.some((s) => s.participantId === participant.id)}
                                onSelect={() => handleVoteSelect(group.id, participant.id)}
                                teamColor={preset.accentColor}
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 sm:gap-4">
                      {participants.map((participant) => (
                        <VotingCard
                          key={participant.id}
                          participant={participant}
                          isSelected={selections.some((s) => s.participantId === participant.id)}
                          onSelect={() => handleVoteSelect(participant.teamId ?? "", participant.id)}
                          teamColor={preset.accentColor}
                        />
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="mb-6 sm:mb-8 animate-fade-in-up">
                    <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-foreground mb-2 sm:mb-3">
                      {preset.heading}
                    </h2>
                    <p className="text-sm sm:text-base text-muted-foreground">{preset.description}</p>
                  </div>

                  <div className="space-y-8 sm:space-y-10">
                    {teams.map((team, teamIdx) => {
                      const teamParticipants = participants.filter((p) => p.teamId === team.id)
                      const teamHasSelection = selections.some((s) => s.teamId === team.id)

                      return (
                        <div key={team.id} className="animate-fade-in-up" style={{ animationDelay: `${teamIdx * 100}ms` }}>
                          <Card
                            className="relative overflow-hidden border-2 mb-6 p-4 sm:p-6 shadow-lg rounded-2xl"
                            style={{
                              borderColor: team.color,
                              background: `linear-gradient(135deg, ${team.color}26, ${team.color}0a)`,
                            }}
                          >
                            {/* Bold left accent bar in the team's own color */}
                            <div className="absolute left-0 top-0 bottom-0 w-2" style={{ backgroundColor: team.color }} />
                            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4 pl-2">
                              <div
                                className="relative w-14 h-14 rounded-full overflow-hidden flex-shrink-0 border-[3px] shadow-md"
                                style={{ borderColor: team.color }}
                              >
                                <Image
                                  src={team.coach.image || "/placeholder.svg"}
                                  alt={team.coach.name}
                                  fill
                                  className="object-cover"
                                />
                              </div>
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <span
                                    className="inline-block w-3 h-3 rounded-full shadow"
                                    style={{ backgroundColor: team.color }}
                                  />
                                  <h3 className="text-xl sm:text-2xl font-extrabold tracking-tight text-foreground">
                                    {team.name}
                                  </h3>
                                </div>
                                <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">Coach: {team.coach.name}</p>
                              </div>
                              <div className="flex items-center gap-3 ml-auto">
                                {teamHasSelection && (
                                  <span
                                    className="text-xs sm:text-sm font-semibold px-3 py-1 rounded-full text-white shadow whitespace-nowrap"
                                    style={{ backgroundColor: team.color }}
                                  >
                                    ✓ Selected
                                  </span>
                                )}
                              </div>
                            </div>
                          </Card>

                          <div className="grid grid-cols-1 gap-3 sm:gap-4">
                            {teamParticipants.map((participant) => (
                              <VotingCard
                                key={participant.id}
                                participant={participant}
                                isSelected={selections.some(s => s.participantId === participant.id)}
                                onSelect={() => handleVoteSelect(team.id, participant.id)}
                                teamColor={team.color}
                              />
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>

            <div className="lg:col-span-1">
              <Card className="bg-card/50 border-border/40 backdrop-blur sticky top-24 animate-slide-in-right">
                <CardHeader>
                  <CardTitle className="text-foreground">Your Vote</CardTitle>
                  <CardDescription>One vote per voting code</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="bg-accent/10 border border-accent/20 rounded-lg p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-widest mb-2">Voting Code</p>
                    <p className="text-lg font-mono font-bold text-foreground">{votingCode}</p>
                  </div>

                  <div className="space-y-3">
                    <h4 className="font-semibold text-foreground text-sm">Selected Poet:</h4>
                    {selectedParticipant ? (
                      <div className="text-sm text-muted-foreground flex items-center gap-2.5">
                        {/* A poet is never named without their face — the voter
                            confirms who they picked, not just a name. */}
                        <div
                          className="relative w-9 h-9 rounded-full overflow-hidden shrink-0 ring-2"
                          style={{
                            // @ts-expect-error -- CSS custom property for the ring colour
                            "--tw-ring-color":
                              mode === "danger"
                                ? preset.accentColor
                                : teams.find((t) => t.id === selections[0]?.teamId)?.color ?? preset.accentColor,
                          }}
                        >
                          <PoetAvatar
                            src={selectedParticipant.image}
                            name={selectedParticipant.name}
                            textClassName="text-xs"
                            sizes="36px"
                          />
                        </div>
                        <span className="font-medium text-foreground">{selectedParticipant.name}</span>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">No poet selected yet</p>
                    )}
                  </div>

                  <div className="border-t border-border/40 pt-4">
                    <p className="text-sm text-muted-foreground mb-4">
                      Each voting code can only be used once. To vote again, purchase another ticket.
                    </p>
                    <Button
                      onClick={handleSubmitVotes}
                      disabled={selections.length !== 1 || isSubmittingVotes}
                      className="w-full bg-gradient-to-r from-primary to-accent hover:shadow-lg hover:shadow-primary/20 disabled:opacity-50 transition-all duration-300 group"
                      size="lg"
                    >
                      {isSubmittingVotes ? (
                        <>
                          <Spinner size="sm" className="mr-2" />
                          Submitting Vote...
                        </>
                      ) : (
                        <>
                          <Lock className="w-4 h-4 mr-2 group-hover:scale-110 transition-transform" />
                          Submit Vote
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
