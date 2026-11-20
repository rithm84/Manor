import Testing
@testable import ManorKit

@Suite("Sign in with Apple")
struct SignInTests {
  @Test func readsTheInvitationTicketFromTheSignupRefusal() {
    let ticket = "676174652d74657374406578616d706c652e696e76616c69647c31373935313332323936.92401cb5fcc59c6568333034a3e9b5531d1921e76296314f9365d841b820cf87"
    #expect(ManorSession.invitationTicket(in: "invitation_required \(ticket)") == ticket)
    // Auth may wrap the hook's message; the ticket still reads cleanly.
    #expect(ManorSession.invitationTicket(in: "Error running hook: invitation_required \(ticket) (403)") == ticket)
  }

  @Test func ignoresOtherRefusals() {
    #expect(ManorSession.invitationTicket(in: "Sign in with Apple to use Manor.") == nil)
    #expect(ManorSession.invitationTicket(in: "invitation_required ") == nil)
  }
}
